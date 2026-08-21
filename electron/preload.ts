/* electron/preload.ts
 *
 * Description of responsibility:
 *   Exposes a minimal, explicit API surface to the renderer despite
 *   contextIsolation being on — currently just focusWindow(), which
 *   routes through the main process's BrowserWindow.focus() rather than
 *   the renderer's own window.focus().
 *
 * Info:
 *   window.focus() from inside the renderer is a "polite" request the OS
 *   is free to ignore (particularly on Windows, where focus-stealing
 *   prevention can silently no-op it) — that's the actual cause behind
 *   the app occasionally losing keyboard input after a native dialog or
 *   certain navigations, recoverable only by some unrelated interaction
 *   (opening DevTools, clicking into a different document) happening to
 *   reassert focus through a path that does work. BrowserWindow.focus(),
 *   called from the main process, uses the real OS-level focus API
 *   (SetForegroundWindow on Windows) and is far more reliable — but it's
 *   only reachable from main, hence this bridge.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  focusWindow: () => ipcRenderer.invoke("focus-window"),
});
