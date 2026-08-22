/* frontend/src/hooks/useEditorPreviewScrollSync.ts
 *
 * Description of responsibility:
 *   Keeps the editor textarea and the rendered preview scrolling
 *   together, driven by a single shared scrollbar (see
 *   SplitScrollbar.tsx) instead of each panel's own native one.
 *
 * Info:
 *   A naive "same percentage scrolled" sync drifts badly once a doc has
 *   any mix of block types that render at different heights per source
 *   line — a GFM table row is one source line but a padded, bordered
 *   rendered row, a heading takes more vertical rhythm than body text,
 *   an image can be hundreds of rendered pixels for one source line.
 *   This instead builds a piecewise-linear map between editor
 *   pixel-offset and preview pixel-offset, anchored at (0,0), at every
 *   source line the preview actually rendered something at, and at each
 *   side's own scroll end. rehypeSourceLines.ts already tags every
 *   rendered element with the source line it came from (originally just
 *   for the toolbars' click-to-pick-existing-block features) — anchoring
 *   on all of them, not just images, is what fixed a dense, image-free
 *   doc like the CLI reference page (all tables/headings) staying badly
 *   misaligned even after the image-only version of this was working
 *   correctly for every other doc. Between anchors it's still a straight
 *   proportional interpolation, but with this many anchors on a typical
 *   doc, "between" only ever spans a few lines rather than whole
 *   sections.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorLineOffsets } from "./useEditorLineOffsets";

interface Anchor {
  editor: number;
  preview: number;
}

function buildMapper(anchors: Anchor[]) {
  function map(value: number, from: "editor" | "preview"): number {
    if (anchors.length < 2) return value;

    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i];
      const b = anchors[i + 1];
      const aFrom = from === "editor" ? a.editor : a.preview;
      const bFrom = from === "editor" ? b.editor : b.preview;
      if (value <= bFrom || i === anchors.length - 2) {
        const span = bFrom - aFrom;
        const t = span > 0 ? (value - aFrom) / span : 0;
        const clampedT = Math.max(0, Math.min(1, t));
        const aTarget = from === "editor" ? a.preview : a.editor;
        const bTarget = from === "editor" ? b.preview : b.editor;
        return aTarget + clampedT * (bTarget - aTarget);
      }
    }
    return value;
  }

  return {
    editorToPreview: (y: number) => map(y, "editor"),
    previewToEditor: (y: number) => map(y, "preview"),
  };
}

export function useEditorPreviewScrollSync(
  content: string,
  editorTextareaRef: React.RefObject<HTMLTextAreaElement | null>,
  previewPanelRef: React.RefObject<HTMLDivElement | null>,
) {
  const [previewLineOffsets, setPreviewLineOffsets] = useState<
    Map<number, number>
  >(new Map());
  const [editorMax, setEditorMax] = useState(0);
  const [previewMax, setPreviewMax] = useState(0);
  const [fraction, setFractionState] = useState(0);

  const syncingRef = useRef(false);

  const previewLineNumbers = useMemo(
    () => Array.from(previewLineOffsets.keys()).sort((a, b) => a - b),
    [previewLineOffsets],
  );

  const editorLineOffsets = useEditorLineOffsets(
    content,
    editorTextareaRef.current,
    previewLineNumbers,
  );

  // Re-measures where every data-source-line element actually landed
  // inside the preview's scrollable content — offset from the
  // *content*, not the current viewport, which is why current scrollTop
  // is added back in. Only the toolbar's own <img> icons ever shared
  // this panel without a data-source-line — they're never selected here
  // at all, since that attribute only exists on the compiled MDX output.
  useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel) return;

    function measure() {
      if (!panel) return;
      const panelRect = panel.getBoundingClientRect();
      const tagged = Array.from(
        panel.querySelectorAll<HTMLElement>("[data-source-line]"),
      );

      // First DOM occurrence per line wins — querySelectorAll returns
      // document order, so for a line shared by an outer block and its
      // own nested inline children (e.g. a <p> and a <code> inside it),
      // the outer/topmost element's offset is what lands here, which is
      // the one that actually represents "the start of this line."
      const offsets = new Map<number, number>();
      for (const el of tagged) {
        const line = parseInt(el.dataset.sourceLine || "", 10);
        if (!Number.isFinite(line) || offsets.has(line)) continue;
        offsets.set(
          line,
          el.getBoundingClientRect().top - panelRect.top + panel.scrollTop,
        );
      }

      setPreviewLineOffsets(offsets);
      setEditorMax(
        Math.max(
          0,
          (editorTextareaRef.current?.scrollHeight ?? 0) -
            (editorTextareaRef.current?.clientHeight ?? 0),
        ),
      );
      setPreviewMax(Math.max(0, panel.scrollHeight - panel.clientHeight));
    }

    measure();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleMeasure() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(measure, 60);
    }

    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(panel, { childList: true, subtree: true });

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(panel);

    // <img> "load" doesn't bubble — capture phase is required to catch it
    // from a descendant image via a single listener on the panel. Images
    // still shift layout as they load in, even though they're no longer
    // the only anchor source.
    panel.addEventListener("load", scheduleMeasure, true);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      panel.removeEventListener("load", scheduleMeasure, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, previewPanelRef, editorTextareaRef.current]);

  const mapper = useMemo(() => {
    const anchors: Anchor[] = [{ editor: 0, preview: 0 }];
    for (const line of previewLineNumbers) {
      const editorOffset = editorLineOffsets.get(line);
      const previewOffset = previewLineOffsets.get(line);
      if (editorOffset === undefined || previewOffset === undefined) continue;
      anchors.push({ editor: editorOffset, preview: previewOffset });
    }
    anchors.push({ editor: editorMax, preview: previewMax });
    return buildMapper(anchors);
  }, [previewLineNumbers, editorLineOffsets, previewLineOffsets, editorMax, previewMax]);

  // Native scroll listeners keep both panels moving together when the
  // user scrolls either one directly (wheel/keyboard/touch) — the custom
  // scrollbar (see SplitScrollbar.tsx) is one more way to drive the same
  // scrollTop assignments, not the only way.
  useEffect(() => {
    const textarea = editorTextareaRef.current;
    const panel = previewPanelRef.current;
    if (!textarea || !panel) return;

    function onEditorScroll() {
      if (syncingRef.current || !textarea || !panel) return;
      syncingRef.current = true;
      panel.scrollTop = mapper.editorToPreview(textarea.scrollTop);
      const max = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
      setFractionState(max > 0 ? textarea.scrollTop / max : 0);
      syncingRef.current = false;
    }

    function onPreviewScroll() {
      if (syncingRef.current || !textarea || !panel) return;
      syncingRef.current = true;
      textarea.scrollTop = mapper.previewToEditor(panel.scrollTop);
      const max = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
      setFractionState(max > 0 ? textarea.scrollTop / max : 0);
      syncingRef.current = false;
    }

    textarea.addEventListener("scroll", onEditorScroll);
    panel.addEventListener("scroll", onPreviewScroll);
    return () => {
      textarea.removeEventListener("scroll", onEditorScroll);
      panel.removeEventListener("scroll", onPreviewScroll);
    };
  }, [mapper, editorTextareaRef, previewPanelRef]);

  function setFraction(f: number) {
    const textarea = editorTextareaRef.current;
    const panel = previewPanelRef.current;
    if (!textarea || !panel) return;

    const clamped = Math.max(0, Math.min(1, f));
    syncingRef.current = true;
    textarea.scrollTop = clamped * editorMax;
    panel.scrollTop = mapper.editorToPreview(textarea.scrollTop);
    syncingRef.current = false;
    setFractionState(clamped);
  }

  const thumbSize =
    editorTextareaRef.current && editorMax + editorTextareaRef.current.clientHeight > 0
      ? Math.max(
          0.04,
          editorTextareaRef.current.clientHeight /
            (editorMax + editorTextareaRef.current.clientHeight),
        )
      : 1;

  return { fraction, setFraction, thumbSize };
}
