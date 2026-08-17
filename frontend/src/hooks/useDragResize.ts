/* frontend/src/hooks/useDragResize.ts
 *
 * Description of responsibility:
 *   Drives the draggable divider between the editor and preview
 *   columns — tracks mouse position while dragging and converts it
 *   into the editor column's width as a percentage of the window.
 *
 * Info:
 *   mousemove/mouseup listeners are attached to window, not the
 *   draggable handle itself, so dragging keeps tracking correctly even
 *   if the cursor moves faster than the handle and ends up outside its
 *   bounds mid-drag.
 */
import { useEffect, useRef, useState } from "react";

export function useDragResize(initialWidth = 50) {
  const [editorWidth, setEditorWidth] = useState(initialWidth);
  const dragging = useRef(false);

  function startDrag() {
    dragging.current = true;
  }

  function stopDrag() {
    dragging.current = false;
  }

  function onDrag(e: MouseEvent) {
    if (!dragging.current) return;
    const pct = (e.clientX / window.innerWidth) * 100;
    setEditorWidth(pct);
  }

  useEffect(() => {
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", stopDrag);
    return () => {
      window.removeEventListener("mousemove", onDrag);
      window.removeEventListener("mouseup", stopDrag);
    };
  }, []);

  return { editorWidth, startDrag };
}
