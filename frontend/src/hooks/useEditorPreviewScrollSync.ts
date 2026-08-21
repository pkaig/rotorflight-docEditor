/* frontend/src/hooks/useEditorPreviewScrollSync.ts
 *
 * Description of responsibility:
 *   Keeps the editor textarea and the rendered preview scrolling
 *   together, driven by a single shared scrollbar (see
 *   SplitScrollbar.tsx) instead of each panel's own native one.
 *
 * Info:
 *   A naive "same percentage scrolled" sync drifts badly once images are
 *   involved: one Markdown/JSX line referencing an image is one line of
 *   *source* but can be hundreds of pixels of *rendered* height, so a
 *   doc with several images bunches up far more preview-height per
 *   source-line near those images than elsewhere. This instead builds a
 *   piecewise-linear map between editor pixel-offset and preview
 *   pixel-offset, anchored at (0,0), at each image's actual position on
 *   both sides (matched in document order — the Nth image line in the
 *   source is assumed to be the Nth <img> the preview rendered, which
 *   holds for normal top-to-bottom docs), and at each side's own scroll
 *   end. Between anchors it's still a straight proportional interpolation
 *   — this doesn't attempt to also correct for headings/tables/code
 *   blocks rendering taller than one line, only for the specific image
 *   case that motivated it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorImageLineOffsets } from "./useEditorImageLineOffsets";

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
  const editorImageOffsets = useEditorImageLineOffsets(
    content,
    editorTextareaRef.current,
  );

  const [previewImageOffsets, setPreviewImageOffsets] = useState<number[]>([]);
  const [editorMax, setEditorMax] = useState(0);
  const [previewMax, setPreviewMax] = useState(0);
  const [fraction, setFractionState] = useState(0);

  const syncingRef = useRef(false);

  // Re-measures where each rendered <img> actually landed inside the
  // preview's scrollable content — offset from the *content*, not the
  // current viewport, which is why current scrollTop is added back in.
  useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel) return;

    function measure() {
      if (!panel) return;
      const panelRect = panel.getBoundingClientRect();
      const imgs = Array.from(panel.querySelectorAll("img"));
      const offsets = imgs.map(
        (img) =>
          img.getBoundingClientRect().top - panelRect.top + panel.scrollTop,
      );
      setPreviewImageOffsets(offsets);
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
    // from a descendant image via a single listener on the panel.
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
    const pairCount = Math.min(
      editorImageOffsets.length,
      previewImageOffsets.length,
    );
    const anchors: Anchor[] = [{ editor: 0, preview: 0 }];
    for (let i = 0; i < pairCount; i++) {
      anchors.push({
        editor: editorImageOffsets[i],
        preview: previewImageOffsets[i],
      });
    }
    anchors.push({ editor: editorMax, preview: previewMax });
    return buildMapper(anchors);
  }, [editorImageOffsets, previewImageOffsets, editorMax, previewMax]);

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
