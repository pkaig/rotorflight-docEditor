/* frontend/src/utils/focusAppWindow.ts
 *
 * Description of responsibility:
 *   Asks the Electron main process to reclaim real OS-level window focus
 *   (via preload.ts's window.electronAPI.focusWindow(), backed by
 *   BrowserWindow.focus() in electron/main.ts) instead of relying on the
 *   renderer's own window.focus().
 *
 * Info:
 *   window.focus() from inside a renderer is a request the OS is free to
 *   ignore — particularly on Windows, where focus-stealing prevention can
 *   silently no-op it. That's the actual cause behind modals in this app
 *   occasionally rendering correctly but not receiving any keyboard input
 *   until some unrelated interaction (opening DevTools, clicking into a
 *   different document) happened to restore focus through a path that
 *   does work. Falls back to plain window.focus() when electronAPI isn't
 *   present (e.g. running the frontend directly in a browser during
 *   development), so this stays a safe no-op degrade rather than a hard
 *   dependency on Electron.
 */
declare global {
  interface Window {
    electronAPI?: {
      focusWindow: () => Promise<void>;
    };
  }
}

export function focusAppWindow(): void {
  if (window.electronAPI?.focusWindow) {
    window.electronAPI.focusWindow().catch(() => {});
  } else {
    window.focus();
  }
}
