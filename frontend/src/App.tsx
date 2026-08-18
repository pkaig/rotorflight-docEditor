/* frontend/src/App.tsx
 *
 * Description of responsibility:
 *   The root application component: owns top-level state (auth,
 *   workspace selection, editor content, sidebar tree UI) and wires
 *   together every major hook (useAuth, useDocEditor, useGitPR,
 *   useDocTrees, useWorkspaces, useAutosave, useUpstreamStatus) and
 *   panel component (Tree, EditorPanel, Preview, ChangesPanel, PRPanel,
 *   ConflictResolver) into the full editing layout.
 *
 * Info:
 *   There is exactly one useGitPR() instance for the whole app, created
 *   here and passed down — useDocEditor and PRPanel used to each create
 *   their own (hooks don't share state across call sites), so notifying
 *   "a file was saved" never reached the instance actually feeding the
 *   rendered Changes panel. findFirstImage() walks the already-loaded
 *   sidebar tree (no extra fetch) to find a folder's first image for
 *   the new-file "example image" seeding in EditorPanel.tsx, using a
 *   case-insensitive sort since the default JS sort would otherwise put
 *   an uppercase-led filename before a lowercase one regardless of
 *   actual alphabetical order.
 */
import "./App.css";
import { version as APP_VERSION } from "../package.json";
import { useState, useEffect } from "react"; // <-- UPDATED
import rfHeliLogo from "./assets/RFHeli.svg";
import PreviewErrorBoundary from "./components/PreviewErrorBoundary";
import Preview from "./components/Preview";
import newDocTemplate from "../templates/newDocTemplate.mdx?raw";
import { EditorPanel } from "./components/EditorPanel";
import { AddImageModal } from "./components/AddImageModal";
import { useUpstreamStatus } from "./hooks/useUpstreamStatus";

import { useAutosave } from "./hooks/useAutosave";
import { useGitPR } from "./hooks/useGitPR";
import { PRPanel } from "./components/PRPanel";
import { ChangesPanel } from "./components/ChangesPanel";
import UnifiedDiffViewer from "./components/UnifiedDiffViewer";
import ConflictResolver from "./components/ConflictResolver";
import { isConflictFile } from "./components/conflictUtils";

import {
  MaintenanceModal,
  ForceUpdateModal,
  UpdateAvailableModal,
} from "./components/versionModals";

import { Tree, type TreeNode } from "./components/Tree";
import { useAuth } from "./hooks/useAuth";
import { useDocTrees } from "./hooks/useDocTrees";
import { useDocEditor } from "./hooks/useDocEditor";
import { useDragResize } from "./hooks/useDragResize";
import { WorkspaceSelector } from "./components/WorkspaceSelector";
import { useWorkspaces } from "./hooks/useWorkspaces";
import { validateWorkspaceName } from "./utils/validateWorkspaceName";

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp)$/i;

type EditorStatus = {
  type: "blocked" | "forceUpdate" | "updateAvailable" | "ok";
  message?: string;
  current?: string;
  latest?: string;
  downloadUrl?: string;
} | null;

// Shape of docEditorStatus.json, the remote version-gate config fetched via
// the backend's /api/version proxy.
interface DocEditorStatusConfig {
  blocked: boolean;
  blockMessage?: string;
  latestVersion: string;
  minSupportedVersion: string;
  updateMessage?: string;
  downloadUrl?: string;
}

type ConflictData = {
  file: string;
  workspace: string;
  workspaceText: string;
  upstreamText: string;
} | null;

// Looks up folderPath within the already-loaded tree (no extra fetch — the
// sidebar already has this data) and returns the alphabetically-first image
// in its img/ subfolder, if any, for the "example image" section new pages
// get seeded with.
function findFirstImage(nodes: TreeNode[], folderPath: string): string | null {
  function findNode(list: TreeNode[]): TreeNode | null {
    for (const n of list) {
      if (n.path === folderPath) return n;
      if (n.children) {
        const found = findNode(n.children);
        if (found) return found;
      }
    }
    return null;
  }

  const folder = findNode(nodes);
  const imgFolder = folder?.children?.find(
    (c) => c.type === "dir" && c.name === "img",
  );
  const images = (imgFolder?.children ?? [])
    .filter((c) => c.type === "file" && IMAGE_RE.test(c.name))
    .map((c) => c.name)
    // Plain .sort() is case-sensitive (all uppercase-first names sort
    // before any lowercase-first one), which doesn't match what a user
    // would consider "first" — e.g. "Bluejay_Complete.png" beating
    // "arming-1.png" purely because 'B' < 'a' in ASCII.
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  return images[0] ?? null;
}

/* -------------------------------------------------------
   ROOT APPLICATION COMPONENT
------------------------------------------------------- */

export default function App() {
  /* AUTH */
  const {
    user,
    login,
    isAuthenticated,
    authStep,
    userCode,
    verificationUri,
    authError,
    startGitHubLogin,
    logout,
  } = useAuth();

  /* WORKSPACE SELECTION */
  const [workspace, setWorkspace] = useState<string | null>(null);

  /* WORKSPACE LIST */
  const { workspaces, loadWorkspaces } = useWorkspaces(login);

  /* VERSION GATE */
  const [editorStatus, setEditorStatus] = useState<EditorStatus>(null);

  /* DOCUMENT TREES (LOCAL ONLY) */
  const { localTrees, loadingLocal, refreshLocalWorkspace } = useDocTrees(
    login,
    workspaces,
    isAuthenticated,
  );

  /* CHANGE TRACKING + PR FLOW — must come before useDocEditor below, since
     notifyFileSaved gets passed into it. This is the single useGitPR()
     instance for the whole app; useDocEditor and PRPanel used to each
     create their own independent one (hooks don't share state across call
     sites), so notifying "a file was saved" never reached the instance
     actually feeding the rendered Changes panel. */
  const {
    banner,
    activePR,
    submitPR,
    submitting,
    changes,
    notifyFileSaved,
    notifyFileRenamed,
    notifyFileCreated,
    clearBanner,
    loadChangesFromMirror,
  } = useGitPR({
    login: login || "",
    workspace,
  });

  /* EDITOR STATE */
  const {
    content,
    setContent,
    currentDocPath,
    setCurrentDocPath,
    loadDoc,
    suppressNextAutosave,
    setSuppressNextAutosave,
    saveState,
    saveDocument,
  } = useDocEditor(login, workspace, notifyFileSaved);

  /* UI STATE */
  // Return value unused — the resizable editor/preview divider this hook
  // drives isn't currently wired to any draggable handle in the JSX below,
  // so it's inert today. Still called so its window mousemove/mouseup
  // listeners are attached, in case that wiring comes back.
  useDragResize(50);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileFolder, setNewFileFolder] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [newFileImageName, setNewFileImageName] = useState<string | null>(null);
  const [showAddImageModal, setShowAddImageModal] = useState(false);
  const [addImageFolder, setAddImageFolder] = useState<string | null>(null);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [showWorkspaceSelector, setShowWorkspaceSelector] = useState(false);
  const { checking, updating } = useUpstreamStatus(login);
  const [showDiff, setShowDiff] = useState(false);
  const [currentFile, setCurrentFile] = useState("");

  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictData, setConflictData] = useState<ConflictData>(null);

  const conflict = isConflictFile(currentDocPath);

  const [selectedChanges, setSelectedChanges] = useState<
    Record<string, boolean>
  >({});

  const effectivePath = currentDocPath || "";

  /* AUTOSAVE */
  const saving = useAutosave(
    login,
    workspace,
    effectivePath,
    content,
    suppressNextAutosave,
    setSuppressNextAutosave,
    saveDocument,
  );

  // -----------------------------
  // VERSION EVALUATION
  // -----------------------------
  function evaluateStatus(
    cfg: DocEditorStatusConfig,
    currentVersion: string,
  ): NonNullable<EditorStatus> {
    function compare(a: string, b: string) {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return 1;
        if (pa[i] < pb[i]) return -1;
      }
      return 0;
    }

    if (cfg.blocked) {
      return { type: "blocked", message: cfg.blockMessage };
    }

    if (compare(currentVersion, cfg.minSupportedVersion) < 0) {
      return {
        type: "forceUpdate",
        current: currentVersion,
        latest: cfg.latestVersion,
        message: cfg.updateMessage,
        downloadUrl: cfg.downloadUrl,
      };
    }

    if (compare(currentVersion, cfg.latestVersion) < 0) {
      return {
        type: "updateAvailable",
        current: currentVersion,
        latest: cfg.latestVersion,
        message: cfg.updateMessage,
        downloadUrl: cfg.downloadUrl,
      };
    }

    return { type: "ok" };
  }

  // -----------------------------
  // Check Upstream
  // -----------------------------
  useEffect(() => {
    async function checkUpstream() {
      if (!login) return;
      const res = await fetch(
        `/api/reset-mirror/upstream-status?login=${login}`,
      );
      const data = await res.json();

      if (data.stale) {
        if (!login) return;
        await fetch(`/api/reset-mirror?login=${login}`, {
          method: "POST",
        });
      }
    }

    checkUpstream();
  }, [login]);

  // -----------------------------
  // EDITOR STATUS CHECK
  // -----------------------------
  useEffect(() => {
    async function checkStatus() {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) {
        setEditorStatus({ type: "ok" });
        return;
      }

      const cfg = await res.json();
      const status = evaluateStatus(cfg, APP_VERSION);
      setEditorStatus(status);
    }

    checkStatus();
  }, []);

  /* AUTH UI */
  if (!isAuthenticated) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src={rfHeliLogo} alt="" className="auth-logo" />
          <h2 className="auth-title">Rotorflight Docs Editor</h2>
          <p className="auth-subtitle">
            Sign in with GitHub to start editing the Rotorflight
            documentation.
          </p>

          {authError && <p className="auth-error">{authError}</p>}

          {authStep === "idle" && (
            <button className="auth-signin-btn" onClick={startGitHubLogin}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              Sign in with GitHub
            </button>
          )}

          {authStep === "polling" && (
            <div className="auth-device-flow">
              <p>
                Open{" "}
                <a
                  href={verificationUri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  this page
                </a>{" "}
                and enter the code:
              </p>

              <div className="auth-device-code">{userCode}</div>

              <p className="auth-waiting">
                <svg
                  className="loading-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    fill="none"
                    stroke="#3578e5"
                    strokeWidth="2"
                    strokeDasharray="56"
                    strokeDashoffset="28"
                    strokeLinecap="round"
                  />
                </svg>
                Waiting for authorisation…
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* -------------------------------------------
     VERSION-GATE MODALS (MAINTENANCE INCLUDED)
  ------------------------------------------- */
  if (editorStatus === null) return null;

  if (editorStatus.type === "blocked") {
    return <MaintenanceModal message={editorStatus.message} />;
  }

  if (editorStatus.type === "forceUpdate") {
    return <ForceUpdateModal {...editorStatus} />;
  }

  if (editorStatus.type === "updateAvailable") {
    return (
      <UpdateAvailableModal
        {...editorStatus}
        onContinue={() => setEditorStatus({ type: "ok" })}
      />
    );
  }

  /* FILE SELECTION */
  // const onSelect = (ws: string, path: string) => {
  //   if (workspace !== ws) {
  //     setWorkspace(ws);
  //     localStorage.setItem("rf_workspace", ws);
  //   }

  //   if (!/\.[a-z0-9]+$/i.test(path)) return;

  //   const isImage = /\.(png|jpe?g|gif|svg|webp)$/i.test(path);
  //   if (isImage) {
  //     setCurrentDocPath(path);
  //     setContent("");
  //     return;
  //   }

  //   loadDoc(path, ws);
  // };

  const onSelect = async (ws: string, path: string) => {
    // -----------------------------------------------------
    // 0. Switch workspace if needed
    // -----------------------------------------------------
    if (workspace !== ws) {
      setWorkspace(ws);
      localStorage.setItem("rf_workspace", ws);
    }

    // -----------------------------------------------------
    // 1. Normalize the path (Tree uses virtual paths)
    // -----------------------------------------------------
    let cleanPath = path;

    const prefix = `local-workspace/${ws}/`;
    if (cleanPath.startsWith(prefix)) {
      cleanPath = cleanPath.slice(prefix.length);
    }

    // Workspace-relative, keeping the docs/ or versioned_docs/ prefix —
    // matches the path format scan-local-changes returns in `changes`,
    // and what the diff-file endpoint now expects.
    const relPath = cleanPath;

    // Only strip docs/ if the tree path actually includes it
    if (path.includes(`/docs/`)) {
      cleanPath = cleanPath.replace(/^.*?docs\//, "");
    }

    // -----------------------------------------------------
    // 2. Check if a conflict file exists
    // -----------------------------------------------------
    const check = await fetch(
      `/api/reset-mirror/has-conflict?login=${login}&workspace=${ws}&file=${cleanPath}`,
    );

    const { conflict } = await check.json();

    if (conflict) {
      // Load the actual conflict content
      const conflictRes = await fetch(
        `/api/reset-mirror/conflict-file?login=${login}&workspace=${ws}&file=${cleanPath}`,
      );

      const conflictData = await conflictRes.json();

      setShowConflictModal(true);
      setConflictData({
        file: cleanPath,
        workspace: ws,
        workspaceText: conflictData.workspace,
        upstreamText: conflictData.upstream,
      });

      return; // stop normal file loading
    }

    // 3. If file is changed but not conflicted → show diff viewer
    // `changes` is { added, modified, deleted, renamed } arrays of
    // { path } entries (from scan-local-changes), not a path-keyed map —
    // `changes[path]` was always undefined, so this branch never actually
    // ran, and even when it did, it set state (showDiffViewer/diffFile)
    // that nothing in the render tree ever read.
    const isChangedFile = (
      changes.added as { path: string }[]
    )
      .concat(changes.modified, changes.deleted, changes.renamed)
      .some((c) => c.path === relPath);

    if (isChangedFile) {
      setCurrentFile(relPath);
      setShowDiff(true);
      loadDoc(path, ws);
      return;
    }

    // -----------------------------------------------------
    // 3. Normal file selection
    // -----------------------------------------------------
    if (!/\.[a-z0-9]+$/i.test(path)) return;

    const isImage = /\.(png|jpe?g|gif|svg|webp)$/i.test(path);
    if (isImage) {
      setCurrentDocPath(path);
      setContent("");
      return;
    }
    // relPath (docs/-prefixed), not cleanPath (stripped) — currentFile must
    // stay in the same full-path format /diff-file and `changes` use, or
    // the diff view resolves the wrong file and comes back empty once this
    // file is edited and saved (see the isChangedFile branch above, which
    // already gets this right).
    setCurrentFile(relPath);
    setShowDiff(false);
    loadDoc(path, ws);
  };

  /* MOVE FILES / NEW PAGE */
  function onDropFolder(ws: string, targetFolderPath: string) {
    if (!draggedItem) return;

    if (draggedItem === "__NEW_PAGE__") {
      setNewFileFolder(targetFolderPath);
      setNewFileName("");
      setShowNewFileModal(true);
      setDraggedItem(null);
      return;
    }

    const filename = draggedItem.split("/").pop();
    const newPath = `${targetFolderPath}/${filename}`;

    fetch(`/api/docs/rename?login=${login}&workspace=${ws}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPath: draggedItem, newPath }),
    }).then(() => {
      notifyFileRenamed("local-workspace", draggedItem, newPath);
      refreshLocalWorkspace(ws);
    });

    setDraggedItem(null);
  }

  /* DELETE WORKSPACE */
  async function handleDeleteWorkspace(ws: string) {
    if (!login) return;

    if (!confirm(`Delete workspace "${ws}"? This cannot be undone.`)) return;

    await fetch(
      `/api/docs/delete-workspace?login=${encodeURIComponent(
        login,
      )}&workspace=${encodeURIComponent(ws)}`,
      { method: "DELETE" },
    );

    await loadWorkspaces();

    if (workspace === ws) {
      setWorkspace(null);
    }
  }

  /* Loading Local Workspace Banner */
  function LoadingLocalBanner({ message }: { message: string }) {
    return (
      <div className="loading-local-banner">
        <svg
          className="loading-icon"
          width="20"
          height="20"
          viewBox="0 0 24 24"
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="#856404"
            strokeWidth="2"
            strokeDasharray="56"
            strokeDashoffset="28"
            strokeLinecap="round"
          />
        </svg>
        <span>{message}</span>
      </div>
    );
  }

  /* MAIN UI */
  // Note: editorStatus.type can only be "ok" once execution reaches here —
  // "blocked"/"forceUpdate"/"updateAvailable" all return a full-screen modal
  // above instead, and updateAvailable's onContinue resets type to "ok"
  // rather than preserving "was dismissed but still outdated". UpdateBanner
  // (a persistent post-dismiss reminder) is exported and imported for
  // exactly this spot but can never actually render as a result — a
  // pre-existing dead path, not something introduced by this fix pass.
  return (
    <div className="app-root">
      {saving && <div className="saving-indicator">Saving…</div>}

      {user && (
        <div className="app-header">
          <div className="app-header-brand">
            <img src={rfHeliLogo} alt="" className="app-header-logo" />
            <span className="app-header-title">Rotorflight Docs Editor</span>
          </div>

          <div className="app-header-user">
            <button
              type="button"
              className="app-header-avatar-btn"
              title="Log out"
              onClick={() => {
                if (confirm("Do you want to logout?")) logout();
              }}
            >
              <img
                src={user.avatar_url}
                alt="avatar"
                className="app-header-avatar"
              />
            </button>
            <span>
              Signed in as <strong>{user.login}</strong>
            </span>
          </div>
        </div>
      )}

      {/* MAIN LAYOUT */}
      <div className="main-layout">
        {/* SIDEBAR */}
        <div className="sidebar">
          <div className="sidebar-top">
            {/* <h3>Docs</h3> */}

            {(checking || updating) && (
              <div
                className={
                  updating
                    ? "workspace-banner warning"
                    : "workspace-banner info"
                }
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  style={{ animation: "spin 1s linear infinite" }}
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    fill="none"
                    stroke={updating ? "#b30000" : "#1a4d8f"}
                    strokeWidth="2"
                    strokeDasharray="56"
                    strokeDashoffset="28"
                    strokeLinecap="round"
                  />
                </svg>

                {updating ? "Updating Rotorflight-docs…" : "Checking upstream…"}
              </div>
            )}

            <div className="workspace-controls">
              <button
                className="add-workspace-btn"
                onClick={() => setShowWorkspaceSelector(true)}
              >
                + Add Workspace
              </button>

              {showWorkspaceSelector && (
                <WorkspaceSelector
                  login={login}
                  onSelect={async (newWorkspaceName) => {
                    if (newWorkspaceName === null) {
                      setShowWorkspaceSelector(false);
                      return;
                    }

                    const error = validateWorkspaceName(newWorkspaceName);
                    if (error) {
                      alert(error);
                      return;
                    }

                    const createRes = await fetch(
                      `/api/docs/create-workspace?login=${login}`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ workspace: newWorkspaceName }),
                      },
                    );

                    if (!createRes.ok) {
                      const body = await createRes.json().catch(() => ({}));
                      alert(
                        `Failed to create workspace: ${body.error || createRes.statusText}`,
                      );
                      return;
                    }

                    await loadWorkspaces();
                    setWorkspace(newWorkspaceName);
                    await refreshLocalWorkspace(newWorkspaceName);
                    setShowWorkspaceSelector(false);
                  }}
                />
              )}

              <div className="workspace-current-label">
                Current workspace: <strong>{workspace}</strong>
              </div>
            </div>

            {/* WORKSPACE TREES */}
            {workspaces.map((ws) => {
              const raw = localTrees[ws] || [];
              const backendRoot = raw[0];

              const nodes = [
                {
                  ...backendRoot,
                  isWorkspaceRoot: true,
                  path: `local-workspace/${ws}`,
                },
              ];

              return (
                <div key={ws} className="workspace-block">
                  <button
                    className="workspace-delete-btn"
                    onClick={() => handleDeleteWorkspace(ws)}
                    title="Delete workspace"
                  >
                    <svg className="workspace-delete-icon" viewBox="0 0 24 24">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                  </button>

                  <Tree
                    nodes={nodes}
                    key={ws}
                    onSelect={(path) => {
                      setWorkspace(ws);
                      onSelect(ws, path);
                    }}
                    onFolderClick={() => setWorkspace(ws)}
                    onDropFolder={(folder) => onDropFolder(ws, folder)}
                    setDraggedItem={setDraggedItem}
                    openFolders={openFolders}
                    setOpenFolders={setOpenFolders}
                    currentPath={currentDocPath}
                    onNewFile={(folderPath) => {
                      setWorkspace(ws);
                      setNewFileFolder(folderPath);
                      setNewFileName("");
                      setNewFileImageName(findFirstImage(nodes, folderPath));
                      setShowNewFileModal(true);
                    }}
                    onNewImage={(folderPath) => {
                      setWorkspace(ws);
                      setAddImageFolder(folderPath);
                      setShowAddImageModal(true);
                    }}
                  />
                </div>
              );
            })}

            {loadingLocal && (
              <div className="loadingLocalWorkspace">
                <LoadingLocalBanner message="Please wait… Loading local workspace" />
              </div>
            )}
          </div>

          {/* CHANGES PANEL */}
          <div className="changes-panel">
            <div className="changes-actions">
              <button
                className="clear-selected-btn"
                onClick={async (e) => {
                  e.stopPropagation();

                  const selected = Object.keys(selectedChanges).filter(
                    (k) => selectedChanges[k],
                  );
                  if (selected.length === 0) return;

                  if (
                    !confirm(
                      `Restore ${selected.length} file(s) from baseline?`,
                    )
                  )
                    return;

                  const ws = workspace;
                  if (!ws) return;

                  const cleanPaths = selected.map((p) => {
                    let clean = p.replace(/^local-workspace\/[^/]+\//, "");

                    if (clean.startsWith("docs/"))
                      clean = clean.slice("docs/".length);
                    if (clean.startsWith("versioned_docs/"))
                      clean = clean.slice("versioned_docs/".length);

                    return clean;
                  });

                  await fetch("/api/reset-mirror/clear-selected", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      login,
                      workspace: ws,
                      files: cleanPaths,
                    }),
                  });

                  await refreshLocalWorkspace(ws);
                  await loadChangesFromMirror();

                  if (
                    cleanPaths.includes(currentDocPath.replace(/^docs\//, ""))
                  ) {
                    loadDoc(currentDocPath, ws);
                  }

                  setSelectedChanges({});
                }}
              >
                Clear selected
              </button>

              <button
                className="clear-all-btn"
                onClick={async () => {
                  if (
                    !confirm(
                      "This will restore ALL files from baseline. Continue?",
                    )
                  )
                    return;

                  const ws = workspace;
                  if (!ws) return;

                  await fetch("/api/reset-mirror/clear-all", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ login, workspace: ws }),
                  });

                  await refreshLocalWorkspace(ws);
                  await loadChangesFromMirror();

                  if (currentDocPath) {
                    loadDoc(currentDocPath, ws);
                  }
                }}
              >
                Clear all
              </button>
            </div>

            <div className="changes-list-container">
              <ChangesPanel
                changes={changes}
                selectedChanges={selectedChanges}
                setSelectedChanges={setSelectedChanges}
                onOpenFile={(rawPath: string) => {
                  const ws = workspace;
                  if (!ws) return;

                  // Build the full path exactly like the tree uses
                  const fullPath = `local-workspace/${ws}/${rawPath}`;

                  setWorkspace(ws);
                  onSelect(ws, fullPath); // ← this already loads the file into the editor
                }}
              />
            </div>
            <div className="pr-panel">
              <PRPanel
                login={login}
                workspace={workspace}
                banner={banner}
                activePR={activePR}
                submitPR={submitPR}
                submitting={submitting}
                clearBanner={clearBanner}
              />
            </div>
          </div>
        </div>

        {showConflictModal && conflictData && (
          <ConflictResolver
            file={conflictData.file}
            workspace={conflictData.workspace}
            workspaceText={conflictData.workspaceText}
            upstreamText={conflictData.upstreamText}
            login={login}
            onMergedChange={(merged) => {
              setContent(merged);
              // Was previously called as saveDocument(conflictData.file, merged,
              // conflictData.workspace) — saveDocument only takes one argument
              // (newContent), so that extra-args call silently saved
              // conflictData.file (a path string) as the document's content
              // instead of the actual merged text, on every keystroke.
              saveDocument(merged);
              refreshLocalWorkspace(conflictData.workspace);
              setShowConflictModal(false);
            }}
            onClose={() => setShowConflictModal(false)}
            onResolved={() => {
              setShowConflictModal(false);
              refreshLocalWorkspace(conflictData.workspace);
            }}
          />
        )}

        <AddImageModal
          isOpen={showAddImageModal}
          folder={addImageFolder}
          login={login}
          onClose={() => setShowAddImageModal(false)}
          onUploaded={async (ws) => {
            await refreshLocalWorkspace(ws);
            await notifyFileSaved();
          }}
        />

        {/* MAIN EDITOR + PREVIEW AREA */}
        <div className="editor-preview-row">
          {/* EDITOR COLUMN */}
          <div className="editor-column">
            <div className="editor-toolbar">
              {!showDiff && (
                <button onClick={() => setShowDiff(true)}>Show Diff</button>
              )}

              {showDiff && (
                <button onClick={() => setShowDiff(false)}>Close Diff</button>
              )}
            </div>

            <div className="editor-scroll-area">
              {showDiff ? (
                <UnifiedDiffViewer
                  key={currentFile}
                  login={login}
                  workspace={workspace}
                  // currentFile already keeps the docs/ or versioned_docs/
                  // prefix (see onSelect's relPath) — /diff-file needs that
                  // prefix to resolve the right path on disk, so only the
                  // local-workspace/<ws>/ virtual-tree prefix gets stripped.
                  file={currentFile.replace(/^local-workspace\/[^/]+\//, "")}
                  onClose={() => setShowDiff(false)}
                />
              ) : (
                <EditorPanel
                  content={content}
                  setContent={setContent}
                  currentDocPath={currentDocPath}
                  conflict={conflict}
                  errorLine={errorLine}
                  saveState={saveState}
                  login={login}
                  workspace={workspace}
                  refreshLocalWorkspace={refreshLocalWorkspace}
                  onSelect={onSelect}
                  showNewFileModal={showNewFileModal}
                  setShowNewFileModal={setShowNewFileModal}
                  newFileName={newFileName}
                  setNewFileName={setNewFileName}
                  newFileFolder={newFileFolder}
                  setNewFileFolder={setNewFileFolder}
                  notifyFileCreated={notifyFileCreated}
                  newDocTemplate={newDocTemplate}
                  newFileImageName={newFileImageName}
                />
              )}
            </div>
          </div>

          {/* PREVIEW COLUMN */}
          <div className="preview-panel">
            <h3>Preview</h3>
            <PreviewErrorBoundary onError={setErrorLine}>
              {currentDocPath &&
                (content.length > 0 ||
                  /\.(png|jpe?g|gif|svg|webp)$/i.test(currentDocPath)) && (
                  <Preview
                    content={content}
                    currentDocPath={currentDocPath}
                    onError={(line) => setErrorLine(line)}
                  />
                )}
            </PreviewErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
}
