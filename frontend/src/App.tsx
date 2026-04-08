import "./App.css";
import { useState, useEffect } from "react"; // <-- UPDATED
import PreviewErrorBoundary from "./components/PreviewErrorBoundary";
import Preview from "./components/Preview";
import newDocTemplate from "../templates/newDocTemplate.mdx?raw";
import { EditorPanel } from "./components/EditorPanel";
import { useUpstreamStatus } from "./hooks/useUpstreamStatus";

import { useAutosave } from "./hooks/useAutosave";
import { useGitPR } from "./hooks/useGitPR";
import { PRPanel } from "./components/PRPanel";
import { ChangesPanel } from "./components/ChangesPanel";
import ConflictResolver from "./components/ConflictResolver";
import { isConflictFile, baseFileName } from "./components/conflictUtils";

import {
  MaintenanceModal,
  ForceUpdateModal,
  UpdateAvailableModal,
  UpdateBanner,
} from "./components/versionModals";

const APP_VERSION = "1.4.2";

import { Tree } from "./components/Tree";
import { useAuth } from "./hooks/useAuth";
import { useDocTrees } from "./hooks/useDocTrees";
import { useDocEditor } from "./hooks/useDocEditor";
import { useDragResize } from "./hooks/useDragResize";
import { WorkspaceSelector } from "./components/WorkspaceSelector";
import { useWorkspaces } from "./hooks/useWorkspaces";
import { validateWorkspaceName } from "./utils/validateWorkspaceName";

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
    startGitHubLogin,
  } = useAuth();

  /* WORKSPACE SELECTION */
  const [workspace, setWorkspace] = useState<string | null>(null);

  /* WORKSPACE LIST */
  const {
    workspaces,
    loading: loadingWorkspaces,
    loadWorkspaces,
  } = useWorkspaces(login);

  /* VERSION GATE */
  const [editorStatus, setEditorStatus] = useState<null | {
    type: "blocked" | "forceUpdate" | "updateAvailable" | "ok";
    message?: string;
    current?: string;
    latest?: string;
    downloadUrl?: string;
  }>(null);

  /* DOCUMENT TREES (LOCAL ONLY) */
  const { localTrees, loadingLocal, refreshLocalWorkspace } = useDocTrees(
    login,
    workspaces,
    isAuthenticated,
  );

  /* EDITOR STATE */
  const {
    content,
    setContent,
    currentDocPath,
    setCurrentDocPath,
    isSyncingImages,
    setIsSyncingImages,
    loadDoc,
    handleCloneToLocal,
    suppressNextAutosave,
    setSuppressNextAutosave,
    saveState,
    saveDocument,
  } = useDocEditor(login, workspace);

  /* UI STATE */
  const { editorWidth, startDrag } = useDragResize(50);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileFolder, setNewFileFolder] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [showWorkspaceSelector, setShowWorkspaceSelector] = useState(false);
  const { checking, stale, updating } = useUpstreamStatus(login);

  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictData, setConflictData] = useState(null);

  const [openWorkspaces, setOpenWorkspaces] = useState<Record<string, boolean>>(
    {},
  );

  const conflict = isConflictFile(currentDocPath);

  /* CHANGE TRACKING + PR FLOW */
  const [selectedChanges, setSelectedChanges] = useState<
    Record<string, boolean>
  >({});

  const {
    banner,
    activePR,
    submitPR,
    changes,
    notifyFileSaved,
    notifyFileRenamed,
    notifyFileCreated,
    clearBanner,
    clearAllChanges,
  } = useGitPR({
    login: login || "",
    workspace,
  });

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
  function evaluateStatus(cfg, APP_VERSION) {
    function compare(a, b) {
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

    if (compare(APP_VERSION, cfg.minSupportedVersion) < 0) {
      return {
        type: "forceUpdate",
        current: APP_VERSION,
        latest: cfg.latestVersion,
        message: cfg.updateMessage,
        downloadUrl: cfg.downloadUrl,
      };
    }

    if (compare(APP_VERSION, cfg.latestVersion) < 0) {
      return {
        type: "updateAvailable",
        current: APP_VERSION,
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
      <div style={{ padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
        <h2>Rotorflight Docs Editor</h2>
        <p>Please sign in with GitHub to continue.</p>

        {authStep === "idle" && (
          <button onClick={startGitHubLogin} style={{ padding: "0.5rem 1rem" }}>
            Sign in with GitHub
          </button>
        )}

        {authStep === "polling" && (
          <div
            style={{
              marginTop: "1rem",
              padding: "1rem",
              background: "#fff3cd",
              border: "1px solid #ffeeba",
              borderRadius: "6px",
            }}
          >
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

            <p
              style={{
                fontSize: "1.5rem",
                fontWeight: "bold",
                marginTop: "0.5rem",
              }}
            >
              {userCode}
            </p>

            <p style={{ marginTop: "0.5rem" }}>Waiting for authorisation…</p>
          </div>
        )}
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

  /* RESTORE SELECTED CHANGES */
  async function clearSelectedChanges(ws: string, paths: string[]) {
    if (!login) return;

    for (const p of paths) {
      console.log("Restore path:", p);
      await fetch(
        `/api/docs/restore-file?login=${encodeURIComponent(
          login,
        )}&workspace=${encodeURIComponent(ws)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: p }),
        },
      );
    }

    await refreshLocalWorkspace(ws);
    setSelectedChanges({});
  }

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

  /* MAIN UI */
  return (
    <>
      {editorStatus.type === "updateAvailable" && (
        <UpdateBanner {...editorStatus} />
      )}
      {saving && (
        <div
          style={{
            position: "absolute",
            top: "8px",
            right: "12px",
            fontSize: "0.85rem",
            color: "#666",
          }}
        >
          Saving…
        </div>
      )}

      {user && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 1rem",
            background: "#f0f0f0",
            borderBottom: "1px solid #ccc",
          }}
        >
          <img
            src={user.avatar_url}
            alt="avatar"
            style={{ width: "32px", height: "32px", borderRadius: "50%" }}
          />
          <span>
            Signed in as <strong>{user.login}</strong>
          </span>
        </div>
      )}

      {/* MAIN LAYOUT */}
      <div style={{ display: "flex", height: "100vh" }}>
        {/* SIDEBAR */}
        <div className="sidebar">
          {/* SIDEBAR TOP */}
          <div className="sidebar-top">
            <h3>Docs</h3>

            {/* UPSTREAM BANNER */}
            {/* UPSTREAM BANNER */}
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

                    await fetch(`/api/docs/create-workspace?login=${login}`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ workspace: newWorkspaceName }),
                    });

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
                  console.log("CLICK START");
                  setTimeout(() => console.log("ASYNC TICK"), 0);

                  e.stopPropagation();

                  const selected = Object.keys(selectedChanges).filter(
                    (k) => selectedChanges[k],
                  );
                  if (selected.length === 0) return;

                  if (
                    !confirm(
                      `Restore ${selected.length} file(s) from Rotorflight docs?`,
                    )
                  )
                    return;

                  const ws = workspace;
                  for (const path of selected) {
                    const clean = path.replace(/^local-workspace\/[^/]+\//, "");

                    await fetch(
                      `/api/docs/restore-file?login=${login}&workspace=${ws}`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ path: clean }),
                      },
                    );
                  }

                  await refreshLocalWorkspace(ws);
                  await clearSelectedChanges(ws, selected);
                }}
              >
                Clear selected
              </button>

              <button
                className="clear-all-btn"
                onClick={async () => {
                  if (!confirm("This will delete ALL local changes. Continue?"))
                    return;

                  const first = Object.keys(changes)[0];
                  const wsMatch = first?.match(/^local-workspace\/([^/]+)\//);
                  const ws = wsMatch ? wsMatch[1] : null;
                  if (!ws) return;

                  await fetch(
                    `/api/docs/reset-local?login=${encodeURIComponent(
                      login || "",
                    )}&workspace=${ws}`,
                    { method: "POST" },
                  );

                  await refreshLocalWorkspace(ws);
                  clearAllChanges();
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
              />
            </div>
            <PRPanel login={login} workspace={workspace} />

            {/*<PRPanel slug={currentDocPath} />*/}
          </div>
        </div>{" "}
        {showConflictModal && (
          <ConflictResolver
            file={conflictData.file}
            workspace={conflictData.workspace}
            workspaceText={conflictData.workspaceText}
            upstreamText={conflictData.upstreamText}
            login={login}
            onMergedChange={(merged) => {
              setContent(merged);
              saveDocument(conflictData.file, merged, conflictData.workspace);
              refreshLocalWorkspace(conflictData.workspace);
              setShowConflictModal(false);
            }}
            onClose={() => setShowConflictModal(false)}
            onResolved={() => {
              setShowConflictModal(false);
              refreshLocalWorkspace(workspace);
            }}
          />
        )}
        {/* MAIN EDITOR + PREVIEW AREA */}
        <div
          style={{
            flex: 1,
            display: "flex",
            overflow: "hidden",
            height: "100vh",
          }}
        >
          {/* EDITOR COLUMN */}
          <div
            className="editor-container"
            style={{
              width: "50%",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              height: "100%",
            }}
          >
            <EditorPanel
              content={content}
              setContent={setContent}
              currentDocPath={currentDocPath}
              conflict={conflict}
              errorLine={errorLine}
              saveState={saveState}
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
            />
          </div>
          <div
            className="preview-panel"
            style={{
              width: "50%",
              minWidth: 0,
              padding: "1rem",
              overflowY: "auto",
            }}
          >
            <h3>Preview</h3>
            <PreviewErrorBoundary onError={setErrorLine}>
              {currentDocPath && content.length > 0 && (
                <Preview content={content} currentDocPath={currentDocPath} />
              )}
            </PreviewErrorBoundary>
          </div>
        </div>
      </div>
    </>
  );
}
