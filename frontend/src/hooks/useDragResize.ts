/* frontend/src/hooks/useDragResize.ts
 *
 * Description of responsibility:
 *   Drives the draggable divider between the editor and preview
 *   columns — tracks mouse position while dragging and converts it
 *   into the editor column's width as a percentage of .editor-preview-row
 *   (not the whole window, which would be wrong once the sidebar's own
 *   width is subtracted out), clamped to 50% ± 25%.
 *
 * Info:
 *   mousemove/mouseup listeners are attached to window, not the
 *   draggable handle itself, so dragging keeps tracking correctly even
 *   if the cursor moves faster than the handle and ends up outside its
 *   bounds mid-drag. rowRef is read fresh on every mousemove rather than
 *   captured once, since the row's own bounding rect shifts whenever the
 *   sidebar is collapsed/expanded.
 */
import { useEffect, useRef, useState } from "react";

const MIN_PERCENT = 25;
const MAX_PERCENT = 75;

export function useDragResize(
  rowRef: React.RefObject<HTMLDivElement | null>,
  initialPercent = 50,
) {
  const [editorPercent, setEditorPercent] = useState(initialPercent);
  const dragging = useRef(false);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = true;
  }

  useEffect(() => {
    function onDrag(e: MouseEvent) {
      if (!dragging.current) return;
      const row = rowRef.current;
      if (!row) return;

      const rect = row.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setEditorPercent(Math.max(MIN_PERCENT, Math.min(MAX_PERCENT, pct)));
    }

    function stopDrag() {
      dragging.current = false;
    }

    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", stopDrag);
    return () => {
      window.removeEventListener("mousemove", onDrag);
      window.removeEventListener("mouseup", stopDrag);
    };
  }, [rowRef]);

  return { editorPercent, startDrag };
}
