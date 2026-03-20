import "./App.css";
import { useState } from "react";
import PreviewErrorBoundary from "./components/PreviewErrorBoundary";
import Preview from "./components/Preview";
import newDocTemplate from "../templates/newDocTemplate.mdx?raw";
import { useAutosave } from "./hooks/useAutosave";
import { useGitPR } from "./hooks/useGitPR";
import { PRPanel } from "./components/PRPanel";
import { ChangesPanel } from "./components/ChangesPanel";
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
import { isLocalPath, normaliseLocalPath } from "./utils/paths";

export default function App() {
  const {
    user,
    login,
    isAuthenticated,
    authStep,
    userCode,
    verificationUri,
    startGitHubLogin,
  } = useAuth();

  const { editorStatus, setEditorStatus } = useVersionGate();

  const {
    localTree,
    githubTree,
    loadingLocal,
    loadingGithub,
    refreshLocalWorkspace,
    refreshGitHubTree,
  } = useDocTrees(login, isAuthenticated);

  const {
    content,
    setContent,
    currentDocPath,
    setCurrentDocPath,
    showEditModal,
    setShowEditModal,
    isSyncingImages,
    setIsSyncingImages,
    clearEditor,
    loadDoc,
    handleCloneToLocal,
  } = useDocEditor(login);

  const { editorWidth, startDrag } = useDragResize(50);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileFolder, setNewFileFolder] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [errorLine, setErrorLine] = useState<number | null>(null);

  const {
    banner,
    activePR,
    submitPR,
    changes,
    notifyFileSaved,
    notifyFileRenamed,
    notifyFileDeleted,
    notifyFileCreated,
    editFile,
    clearBanner,
    clearAllChanges,
  } = useGitPR({
    refreshGitHubTree,
    clearEditor,
    openEditFileModal: () => setShowEditModal(true),
    login,
  });

  const effectivePath = currentDocPath || "";

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

  const saving = useAutosave(
    login || "",
    effectivePath,
    content,
    async (path, content) => {
      const workspaceRelative = path
        .replace(/^local-workspace\//, "")
        .replace(/^Rotorflight-docs\//, "");

      // Fetch the current on-disk content
      const res = await fetch(
        `/api/docs/load?path=${encodeURIComponent(path)}&login=${encodeURIComponent(login || "")}`,
      );
      const data = await res.json();
      const existing = data?.content ?? "";

      // Only save + notify if content actually changed
      if (existing === content) {
        return; // No-op: do NOT notifyFileSaved
      }

      await fetch(`/api/docs/save?login=${encodeURIComponent(login || "")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workspaceRelative, content }),
      });

      notifyFileSaved("Rotorflight-docs", workspaceRelative);
    },
  );

  if (!editorStatus) return null;

  if (editorStatus.type === "blocked") {
    return <MaintenanceModal {...editorStatus} />;
  }

  if (editorStatus.type === "forceUpdate") {
    return <ForceUpdateModal {...editorStatus} />;
  }

  if (editorStatus.type === "updateAvailable") {
    return (
      <UpdateAvailableModal
        {...editorStatus}
        onContinue={() => {
          const timeout = Date.now() + 60 * 1000;
          localStorage.setItem("rf_dismissed_until", timeout.toString());
          setEditorStatus({ type: "ok" });
        }}
      />
    );
  }

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

  const onSelect = (path: string) => {
    // Ignore folder clicks (no extension)
    if (!/\.[a-z0-9]+$/i.test(path)) {
      return;
    }

    const isImage = /\.(png|jpe?g|gif|svg|webp)$/i.test(path);
    if (isImage) {
      console.log("Selected image:", path);
      // Don’t load into editor
      setCurrentDocPath(path);
      setContent(""); // clear editor
      return;
    }

    loadDoc(path);
  };

  function onDropFolder(targetFolderPath: string) {
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

    fetch("http://localhost:4000/api/docs/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPath: draggedItem, newPath }),
    }).then(() => {
      notifyFileRenamed("Rotorflight-docs", draggedItem, newPath);
      refreshLocalWorkspace();
    });

    setDraggedItem(null);
  }

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

  function LoadingGithubBanner({ message }: { message: string }) {
    return (
      <div className="loading-github-banner">
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

  async function onEditThisFile() {
    setIsSyncingImages(true);

    // Clone file → refresh local tree → load doc
    const clonedPath = await handleCloneToLocal(refreshLocalWorkspace);

    // 1. Collapse GitHub tree
    setOpenFolders((prev) => ({
      ...prev,
      "Rotorflight-docs": false,
    }));

    // 2. Expand local-workspace root
    setOpenFolders((prev) => ({
      ...prev,
      "local-workspace": true,
    }));

    // 3. Expand all parent folders of the cloned file
    expandFolderChain(clonedPath);

    // 4. Select the file in the tree
    setCurrentDocPath(clonedPath);

    setIsSyncingImages(false);
  }

  return (
    <>
      {/* {banner && (
        <Banner
          type={banner.type}
          prNumber={banner.prNumber}
          onClose={clearBanner}
        />
      )} */}

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

      <div style={{ display: "flex", height: "100vh" }}>
        <div className="sidebar">
          <h3>Docs</h3>
          <button onClick={refreshLocalWorkspace}>Refresh Local</button>

          {loadingLocal && (
            <div className="loadingLocalWorkspace">
              <LoadingLocalBanner message="Please wait… Loading local workspace" />
            </div>
          )}

          {!loadingLocal && loadingGithub && (
            <div className="loadingGithub">
              <LoadingGithubBanner message="Please wait… Loading docs from GitHub" />
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto" }}>
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", "__NEW_PAGE__");
                setDraggedItem("__NEW_PAGE__");
              }}
              className="new-page-draggable new-page-btn"
            >
              + New Page (drag into folder)
            </div>

            {/* {console.log(
              "FRONTEND LOCAL TREE:",
              new Date().getMinutes(),
              ":",
              new Date().getSeconds(),
              JSON.stringify(localTree, null, 2),
            )} */}

            {localTree && (
              <Tree
                nodes={localTree}
                onSelect={onSelect}
                onDropFolder={onDropFolder}
                setDraggedItem={setDraggedItem}
                openFolders={openFolders}
                setOpenFolders={setOpenFolders}
              />
            )}

            {githubTree && (
              <Tree
                nodes={[githubTree]}
                onSelect={onSelect}
                onDropFolder={onDropFolder}
                setDraggedItem={setDraggedItem}
                openFolders={openFolders}
                setOpenFolders={setOpenFolders}
              />
            )}
          </div>

          <PRPanel
            slug={currentDocPath}
            refreshGitHubTree={refreshGitHubTree}
            clearEditor={clearEditor}
            openEditFileModal={() => setShowEditModal(true)}
          />
          <div className="changes-panel">
            <button
              className="clear-all-btn"
              onClick={async () => {
                if (!confirm("This will delete ALL local changes. Continue?"))
                  return;

                await fetch(
                  `/api/docs/reset-local?login=${encodeURIComponent(login || "")}`,
                  {
                    method: "POST",
                  },
                );

                refreshLocalWorkspace();
                //                refreshGitHubTree();
                clearAllChanges();
              }}
            >
              Clear all changes
            </button>
            <ChangesPanel changes={changes} />
          </div>
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            overflow: "hidden",
            height: "100%", // ← required
            position: "relative", // ← helps anchor children
          }}
        >
          <div
            className="editor-container"
            style={{
              width: `${editorWidth}%`,
              position: "relative", // ← anchor for modal
              display: "flex",
              flexDirection: "column",
              height: "100%", // ensures overlay fills only this panel
            }}
          >
            {showEditModal && !isSyncingImages && (
              <div className="edit-modal-overlay">
                <div className="edit-modal-box">
                  <h3>Edit this file?</h3>
                  <p>
                    This file is from GitHub. A local copy will be created and
                    its
                    <code> img/ </code> folder will be synced so you can edit
                    safely.
                  </p>

                  <div className="edit-modal-buttons">
                    <button onClick={onEditThisFile}>Edit this file</button>
                  </div>
                </div>
              </div>
            )}

            {isSyncingImages && (
              <div className="edit-modal-overlay">
                <div className="edit-modal-box">
                  <h3>Loading images into workspace…</h3>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      marginTop: "1rem",
                    }}
                  >
                    <svg
                      className="loading-icon"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      style={{ animation: "spin 1s linear infinite" }}
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

                    <span>
                      Please wait while we sync to the <br />
                      local-workspace…
                    </span>
                  </div>
                </div>
              </div>
            )}

            <h3>Editor</h3>
            {showNewFileModal && (
              <div className="edit-modal-overlay">
                <div className="edit-modal-box">
                  <h3>Create new page</h3>

                  <p>Enter a file name (without extension):</p>

                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder="my-new-page"
                    style={{ width: "100%", marginTop: "0.5rem" }}
                  />

                  <div
                    className="edit-modal-buttons"
                    style={{ marginTop: "1rem" }}
                  >
                    <button
                      onClick={() => {
                        const safe = newFileName.trim().replace(/\s+/g, "-");
                        if (!safe || !newFileFolder) return;

                        const newPath = `${newFileFolder}/${safe}.mdx`;

                        setCurrentDocPath(newPath);
                        setContent(newDocTemplate);

                        notifyFileCreated("local-workspace", newPath);
                        //notifyFileCreated("Rotorflight-docs", newPath);

                        setShowNewFileModal(false);
                        setNewFileFolder(null);
                        refreshLocalWorkspace();
                      }}
                    >
                      Create
                    </button>

                    <button
                      onClick={() => {
                        setShowNewFileModal(false);
                        setNewFileFolder(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              style={{
                flex: 1,
                width: "100%",
                minHeight: 0,
                fontFamily: "monospace",
                fontSize: "14px",
                padding: "1rem",
                border: "1px solid #ccc",
                borderRadius: 4,
                background:
                  errorLine !== null
                    ? `linear-gradient(
                        to bottom,
                        transparent ${(errorLine - 1) * 1.4}rem,
                        #ffe6e6 ${(errorLine - 1) * 1.4}rem,
                        #ffe6e6 ${errorLine * 1.4}rem,
                        transparent ${errorLine * 1.4}rem
                      )`
                    : "white",
              }}
            />
          </div>

          <div onMouseDown={startDrag} className="drag-handle" />

          <div
            style={{
              flex: 1,
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
