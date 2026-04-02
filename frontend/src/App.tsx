import "./App.css";
import { useState } from "react";
import PreviewErrorBoundary from "./components/PreviewErrorBoundary";
import Preview from "./components/Preview";
import newDocTemplate from "../templates/newDocTemplate.mdx?raw";
import { EditorPanel } from "./components/EditorPanel";

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
} from "./components/versionModals";

import { Tree } from "./components/Tree";
import { useAuth } from "./hooks/useAuth";
import { useVersionGate } from "./hooks/useVersionGate";
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
  const { editorStatus, setEditorStatus } = useVersionGate();

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
    clearEditor,
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
    editFile,
    clearBanner,
    clearAllChanges,
  } = useGitPR({
    clearEditor,
    login: login || "",
    workspace,
  });

  const effectivePath = currentDocPath || "";

  /* FOLDER EXPANSION */
  function expandFolderChain(fullPath: string) {
    const parts = fullPath.split("/");
    let accum = "";
    const updates: Record<string, boolean> = {};

    for (let i = 0; i < parts.length - 1; i++) {
      accum = accum ? `${accum}/${parts[i]}` : parts[i];
      updates[accum] = true;
    }

    setOpenFolders((prev) => ({ ...prev, ...updates }));
  }

  /* AUTOSAVE */
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

  /* FILE SELECTION */
  const onSelect = (ws: string, path: string) => {
    if (workspace !== ws) {
      setWorkspace(ws);
      localStorage.setItem("rf_workspace", ws);
    }

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
      clearEditor();
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

  /* MAIN UI */
  return (
    <>
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
                  e.stopPropagation();

                  const selected = Object.keys(selectedChanges).filter(
                    (k) => selectedChanges[k],
                  );
                  if (selected.length === 0) return;

                  if (
                    !confirm(`Restore ${selected.length} file(s) from GitHub?`)
                  )
                    return;

                  const wsMatch = selected[0].match(
                    /^local-workspace\/([^/]+)\//,
                  );
                  const ws = wsMatch ? wsMatch[1] : null;
                  if (!ws) return;

                  for (const path of selected) {
                    await fetch(
                      `/api/docs/restore-file?login=${login}&workspace=${ws}`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ path }),
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

            <PRPanel slug={currentDocPath} clearEditor={clearEditor} />
          </div>
        </div>{" "}
        {/* END SIDEBAR */}
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
          {/*<div
            className="editor-column"
            style={{
              width: `${editorWidth}%`,
              display: "flex",
              flexDirection: "column",
              height: "100%",
              overflow: "hidden",
            }}
          >*/}
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

          {/* DRAG HANDLE */}
          {/*<div onMouseDown={startDrag} className="drag-handle" />*/}

          {/* PREVIEW COLUMN */}
          {/*<div
            style={{
              flex: 1,
              padding: "1rem",
              overflowY: "auto",
            }}
          >*/}
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
