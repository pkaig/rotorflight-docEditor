/* frontend/src/main.tsx
 *
 * Description of responsibility:
 *   Vite/React entry point — mounts <App> into the DOM inside
 *   StrictMode and a top-level AppErrorBoundary.
 *
 * Info:
 *   None beyond the standard Vite React template shape.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { AppErrorBoundary } from "./components/AppErrorBoundary.tsx";

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <StrictMode>
      <App />
    </StrictMode>
  </AppErrorBoundary>,
);
