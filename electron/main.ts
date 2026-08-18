/* electron/main.ts
 *
 * Description of responsibility:
 *   The Electron main-process entry point for the packaged desktop app.
 *   Redirects the backend's data directory into the OS's proper per-user
 *   app-data folder, starts the existing Express server in-process
 *   (production mode, same combined frontend+API server built for
 *   `node dist/server.js`), waits for it to actually be ready, then opens
 *   a BrowserWindow pointed at it.
 *
 * Info:
 *   Deliberately does NOT spawn the backend as a separate child process —
 *   Electron's main process is already a full Node.js process, so
 *   requiring the backend's compiled server.js directly (which starts
 *   listening as a side effect of being imported) is simpler than
 *   managing a second process's lifecycle for an app this size.
 *
 *   process.chdir() to the userData directory happens BEFORE requiring
 *   the backend, and nothing in the backend itself had to change for
 *   this to work: every backend file that stores real data (workspaces,
 *   saved tokens, the upstream git mirror) already computes its path via
 *   process.cwd() rather than __dirname specifically so it behaves the
 *   same whether run from source or from compiled dist/ output — the
 *   same mechanism means it also transparently lands in the right place
 *   here, with zero backend code aware that it's running inside
 *   Electron at all.
 *
 *   FRONTEND_DIST_PATH is a separate concern from the cwd redirect
 *   above: server.ts needs to find the *packaged app's own* frontend
 *   build (inside the installed app's resources, not the user's data
 *   folder), which isn't reachable via a process.cwd()-relative "../
 *   frontend/dist" the way it is in plain `node dist/server.js` — so
 *   this is passed explicitly instead.
 */
import { app, BrowserWindow, dialog } from "electron";
import path from "path";
import fs from "fs";
import http from "http";

const PORT = process.env.PORT || "4000";

// Electron packages application code (this file, the backend, the built
// frontend) inside process.resourcesPath once packaged; app.getAppPath()
// covers the equivalent location when running unpackaged (electron .) —
// app.getAppPath() there already resolves to the repo root itself (where
// package.json lives, with backend/ and frontend/ directly inside it), so
// unlike the packaged case it needs no adjustment.
const RESOURCES_ROOT = app.isPackaged
  ? process.resourcesPath
  : app.getAppPath();

function startBackend(): void {
  console.log("RESOURCES_ROOT:", RESOURCES_ROOT, "| packaged:", app.isPackaged);

  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });

  // Every workspace/token/mirror path in the backend is process.cwd()-
  // relative — redirecting cwd here, before requiring the backend at
  // all, is what puts all of that in the OS's real per-user app-data
  // folder instead of wherever this process happened to launch from.
  process.chdir(userDataDir);

  process.env.NODE_ENV = "production";
  process.env.PORT = PORT;
  process.env.FRONTEND_DIST_PATH = path.join(
    RESOURCES_ROOT,
    "frontend",
    "dist",
  );

  // Packaged as resources/backend/dist/server.js with resources/backend/
  // node_modules/ as its sibling (not flattened together) specifically so
  // Node's normal require() resolution — walking up from server.js
  // through parent node_modules folders — finds it exactly the way it
  // already does for a plain `node backend/dist/server.js` run.
  require(path.join(RESOURCES_ROOT, "backend", "dist", "server.js"));
}

// Confirms the health endpoint answers AND that whatever answered is
// actually our own production instance — not just anything on this port.
// A leftover dev-mode instance of this same app (started via `npm run
// dev` and never closed) answers this exact same route identically
// except for `mode`, so a bare "did something respond" check can't tell
// the two apart: it'll happily open a window against a server that never
// registers the frontend-serving code (dev mode expects Vite's own dev
// server for that instead), producing a confusing "Cannot GET /" with no
// indication of what's actually wrong.
function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    function attempt() {
      http
        .get(url, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              if (body.mode === "production") {
                resolve();
                return;
              }
              reject(
                new Error(
                  `Something else is already using port ${PORT} (responded ` +
                    `with mode="${body.mode}", not this app's own production ` +
                    `instance). Close whatever that is — likely a leftover ` +
                    `"npm run dev" from testing — and try again.`,
                ),
              );
            } catch (err) {
              reject(
                new Error(
                  `Port ${PORT} is already in use by something that isn't ` +
                    `this app (its /api/health response wasn't valid JSON).`,
                ),
              );
            }
          });
        })
        .on("error", () => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error(`Server did not respond at ${url} in time`));
            return;
          }
          setTimeout(attempt, 200);
        });
    }
    attempt();
  });
}

// Same RESOURCES_ROOT-relative resolution as the frontend build: shipped
// via extraResources (see package.json), not `files`, so it lands next to
// backend/frontend under resources/ rather than inside the app's asar —
// consistent with how everything else non-code this app needs at runtime
// is resolved.
const ICON_PATH = path.join(RESOURCES_ROOT, "electron", "icon.ico");

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Rotorflight Docs Editor",
    icon: ICON_PATH,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.setMenuBarVisibility(false);
  await win.loadURL(`http://localhost:${PORT}/`);
}

app.whenReady().then(async () => {
  try {
    startBackend();
    await waitForServer(`http://localhost:${PORT}/api/health`, 15000);
    await createWindow();
  } catch (err) {
    console.error("Startup failed:", err);
    dialog.showErrorBox(
      "Rotorflight Docs Editor failed to start",
      String(err),
    );
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
