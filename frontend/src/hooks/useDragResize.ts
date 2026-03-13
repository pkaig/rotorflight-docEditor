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
