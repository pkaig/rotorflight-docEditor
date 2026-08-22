/* frontend/src/hooks/useEditorLineOffsets.ts
 *
 * Description of responsibility:
 *   Measures the pixel offset (within the editor textarea's own scroll
 *   content) of an arbitrary set of source lines, so the scroll-sync
 *   hook has real anchor points for whichever lines the preview
 *   actually rendered something at — not just image lines (see
 *   useEditorPreviewScrollSync, which now anchors on every
 *   data-source-line the preview produced, generalizing what this hook
 *   used to do only for images).
 *
 * Info:
 *   A <textarea> can't report "where is line N on screen" itself once
 *   long lines wrap, so this builds a hidden mirror element — same
 *   font/line-height/padding/width/word-break as the real textarea,
 *   read live via getComputedStyle rather than hardcoded, matching the
 *   technique SpellcheckTextarea's own backdrop already uses to stay
 *   pixel-aligned — with a marker <span> at the start of every
 *   requested line, then reads each marker's offsetTop. Re-runs on
 *   content/line-number changes and on the textarea's own resize (e.g.
 *   the sidebar collapsing changes editor width, which changes
 *   wrapping).
 */
import { useEffect, useRef, useState } from "react";

export function useEditorLineOffsets(
  content: string,
  textareaEl: HTMLTextAreaElement | null,
  lineNumbers: number[],
): Map<number, number> {
  const [offsets, setOffsets] = useState<Map<number, number>>(new Map());
  const mirrorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mirrorRef.current) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.visibility = "hidden";
      el.style.top = "0";
      el.style.left = "-99999px";
      el.style.pointerEvents = "none";
      document.body.appendChild(el);
      mirrorRef.current = el;
    }
    return () => {
      mirrorRef.current?.remove();
      mirrorRef.current = null;
    };
  }, []);

  // lineNumbers is a derived array (recomputed each render in the
  // caller) — stringifying it for the dependency comparison avoids
  // re-measuring every render when the actual line set hasn't changed.
  const lineNumbersKey = lineNumbers.join(",");

  useEffect(() => {
    if (!textareaEl) return;

    function measure() {
      const mirror = mirrorRef.current;
      if (!mirror || !textareaEl) return;

      if (lineNumbers.length === 0) {
        setOffsets(new Map());
        return;
      }

      const cs = getComputedStyle(textareaEl);
      mirror.style.boxSizing = cs.boxSizing;
      mirror.style.width = `${textareaEl.clientWidth}px`;
      mirror.style.font = cs.font;
      mirror.style.fontFamily = cs.fontFamily;
      mirror.style.fontSize = cs.fontSize;
      mirror.style.fontWeight = cs.fontWeight;
      mirror.style.lineHeight = cs.lineHeight;
      mirror.style.letterSpacing = cs.letterSpacing;
      mirror.style.tabSize = cs.tabSize;
      mirror.style.padding = cs.padding;
      mirror.style.border = cs.border;
      mirror.style.whiteSpace = "pre-wrap";
      mirror.style.wordBreak = "normal";
      mirror.style.overflowWrap = "normal";

      const lines = content.split("\n");
      const wanted = new Set(lineNumbers);
      mirror.textContent = "";

      const markers = new Map<number, HTMLSpanElement>();
      lines.forEach((lineText, idx) => {
        const lineNumber = idx + 1;
        if (wanted.has(lineNumber)) {
          const marker = document.createElement("span");
          marker.textContent = "";
          mirror.appendChild(marker);
          markers.set(lineNumber, marker);
        }
        mirror.appendChild(document.createTextNode(lineText));
        if (idx < lines.length - 1) mirror.appendChild(document.createTextNode("\n"));
      });

      const measured = new Map<number, number>();
      markers.forEach((marker, lineNumber) => {
        measured.set(lineNumber, marker.offsetTop);
      });

      setOffsets(measured);
    }

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(textareaEl);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, textareaEl, lineNumbersKey]);

  return offsets;
}
