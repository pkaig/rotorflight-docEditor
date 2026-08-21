/* frontend/src/components/SplitScrollbar.tsx
 *
 * Description of responsibility:
 *   The single vertical scrollbar shown between the editor and preview
 *   columns, replacing each panel's own native scrollbar (see
 *   useEditorPreviewScrollSync, which drives the two panels' actual
 *   scrollTop from the same fraction this thumb represents). Also the
 *   drag handle for resizing the editor/preview split — dragging the
 *   thumb scrolls, dragging the track background around it resizes,
 *   distinguished by which element the mousedown actually landed on.
 *
 * Info:
 *   Thumb size is expressed as a fraction of the track (0..1) rather
 *   than a pixel height computed here — the caller already has to know
 *   the editor's own clientHeight/scrollHeight for the sync math, so it
 *   passes the ratio through rather than this component re-deriving it
 *   from a ref of its own.
 */
import { useRef } from "react";

interface SplitScrollbarProps {
  fraction: number;
  thumbSize: number;
  onFractionChange: (f: number) => void;
  onResizeStart: (e: React.MouseEvent) => void;
}

export function SplitScrollbar({
  fraction,
  thumbSize,
  onFractionChange,
  onResizeStart,
}: SplitScrollbarProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  function fractionFromClientY(clientY: number): number {
    const track = trackRef.current;
    if (!track) return fraction;
    const rect = track.getBoundingClientRect();
    const thumbPx = Math.max(20, thumbSize * rect.height);
    const usable = rect.height - thumbPx;
    if (usable <= 0) return 0;
    const y = clientY - rect.top - thumbPx / 2;
    return Math.max(0, Math.min(1, y / usable));
  }

  function startScrollDrag(e: React.MouseEvent) {
    e.preventDefault();
    // Stops this from also bubbling up to the track's own mousedown,
    // which would otherwise start a column-resize drag at the same time.
    e.stopPropagation();
    onFractionChange(fractionFromClientY(e.clientY));

    function onMove(ev: MouseEvent) {
      onFractionChange(fractionFromClientY(ev.clientY));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const thumbPercent = Math.max(4, thumbSize * 100);
  const topPercent = fraction * (100 - thumbPercent);

  return (
    <div
      ref={trackRef}
      className="split-scrollbar-track"
      title="Drag to resize the editor/preview split"
      onMouseDown={onResizeStart}
    >
      <div
        className="split-scrollbar-thumb"
        title="Drag to scroll"
        style={{ height: `${thumbPercent}%`, top: `${topPercent}%` }}
        onMouseDown={startScrollDrag}
      />
    </div>
  );
}
