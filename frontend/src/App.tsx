import "./App.css";
import { useEffect, useState, useRef } from "react";
import PreviewErrorBoundary from "./PreviewErrorBoundary";
import Preview from "./Preview";
import newDocTemplate from "../templates/newDocTemplate.mdx?raw";
import {
  MaintenanceModal,
  ForceUpdateModal,
  UpdateAvailableModal,
} from "./versionModals";

const APP_VERSION = "1.4.2";
//localStorage.setItem("rf_dismissed_until", Date.now().toString());

type DocItem = {
  id: string;
  title: string;
  path: string;
  download_url: string;
};

type TreeNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
};

function Tree({
  nodes,
  onSelect,
  onDropFolder,
  setDraggedItem,
  openFolders,
  setOpenFolders,
}) {
  const safeNodes = Array.isArray(nodes) ? nodes : [];
  const folders = openFolders || {};

  function toggleFolder(path) {
    if (!path) return;
    setOpenFolders((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  return (
    <ul className="tree-list">
      {safeNodes.map((node) => (
        <li key={node.path || node.name}>
          {node.type === "dir" ? (
            <div className="tree-dir">
              <div
                className={
                  "tree-folder " +
                  (node.name === "local-workspace" ? "folder-local" : "") +
                  (node.name === "docs" ? "folder-docs" : "")
                }
                onClick={() => toggleFolder(node.path)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => node.path && onDropFolder(node.path)}
              >
                {node.name}
              </div>

              {node.path && folders[node.path] && (
                <Tree
                  nodes={node.children || []}
                  onSelect={onSelect}
                  onDropFolder={onDropFolder}
                  setDraggedItem={setDraggedItem}
                  openFolders={folders}
                  setOpenFolders={setOpenFolders}
                />
              )}
            </div>
          ) : (
            <button
              className="tree-item"
              draggable
              onDragStart={() => setDraggedItem(node.path)}
              onClick={() => onSelect(node.path)}
            >
              {node.name}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  // -----------------------------
  // STATE
  // -----------------------------
  // const [tree, setTree] = useState<TreeNode[]>([]);
  const [content, setContent] = useState("");
  const [editorWidth, setEditorWidth] = useState(50);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const dragging = useRef(false);

  const [currentDocPath, setCurrentDocPath] = useState("");

  const [commitMessage, setCommitMessage] = useState("");
  const [prBody, setPrBody] = useState("");
  const [branch, setBranch] = useState("");
  const [email, setEmail] = useState("");

  const [openFolders, setOpenFolders] = useState({});
  const [showEditModal, setShowEditModal] = useState(false);
  const [pendingGitHubPath, setPendingGitHubPath] = useState("");

  const [loadingLocal, setLoadingLocal] = useState(true);
  const [loadingGithub, setLoadingGithub] = useState(true);

  const [user, setUser] = useState<{
    login: string;
    name: string;
    avatar_url: string;
  } | null>(null);

  const [editorStatus, setEditorStatus] = useState<null | {
    type: "blocked" | "forceUpdate" | "updateAvailable" | "ok";
    message?: string;
    current?: string;
    latest?: string;
    downloadUrl?: string;
  }>(null);

  // -----------------------------
  // AUTH STATE
  // -----------------------------
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authStep, setAuthStep] = useState<"idle" | "waiting" | "polling">(
    "idle",
  );
  const [login, setLogin] = useState<string | null>(null);
  const [userCode, setUserCode] = useState("");
  const [verificationUri, setVerificationUri] = useState("");
  const [editorImageFolder, setEditorImageFolder] = useState<string | null>(
    null,
  );

  // Tree states
  const [githubTree, setGithubTree] = useState(null);
  const [localTree, setLocalTree] = useState(null);

  // Drag state
  const [draggedItem, setDraggedItem] = useState<string | null>(null);

  // -----------------------------
  // RESTORE LOGIN ON MOUNT
  // -----------------------------
  useEffect(() => {
    const storedLogin = localStorage.getItem("rf_login");
    if (!storedLogin) return;

    fetch(`http://localhost:4000/api/auth/status/${storedLogin}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          setLogin(storedLogin);
          setIsAuthenticated(true);
        } else {
          localStorage.removeItem("rf_login");
        }
      })
      .catch((err) => console.error("Failed to check auth status:", err));
  }, []);
  // -----------------------------
  // LOAD LOCAL TREE AFTER AUTH
  // -----------------------------
  useEffect(() => {
    if (!isAuthenticated || !login) return;
    loadLocalTree(); // stage 1
  }, [isAuthenticated, login]);

  // -----------------------------
  // LOAD GITHUB TREE AFTER LOCAL IS READY
  // -----------------------------
  useEffect(() => {
    // must be authenticated
    if (!isAuthenticated || !login) return;

    // must have a real local tree (not null, not undefined)
    if (!localTree) return;

    // must have children (ensures the tree is fully loaded)
    if (!localTree.children) return;

    loadGithubTree(); // stage 2
  }, [localTree, isAuthenticated, login]);

  // -----------------------------
  // GITHUB LOADER (stage 2)
  // -----------------------------
  // async function loadGithubTree() {
  //   setLoadingGithub(true);

  //   const res = await fetch(`/api/docs/list?login=${login}`);
  //   const data = await res.json();

  //   const github = data.docs.find((x) => x.name !== "local-workspace");
  //   setGithubTree(github);

  //   setLoadingGithub(false);
  // }

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
  // EDITOR STATUS CHECK
  // -----------------------------
  useEffect(() => {
    async function checkStatus() {
      const url =
        "https://raw.githubusercontent.com/rotorflight/rotorflight-docs/main/config/docEditorStatus.json";

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        setEditorStatus({ type: "ok" });
        return;
      }

      const cfg = await res.json();

      // TIMEOUT CHECK
      const dismissedUntil = localStorage.getItem("rf_dismissed_until");
      if (dismissedUntil && Date.now() < Number(dismissedUntil)) {
        setEditorStatus({ type: "ok" });
        return;
      }

      const status = evaluateStatus(cfg, APP_VERSION);
      setEditorStatus(status);
    }

    checkStatus();
  }, []);

  // -----------------------------
  // CLEAR AUTH
  // -----------------------------
  function clearAuth() {
    setIsAuthenticated(false);
    setLogin(null);
    localStorage.removeItem("rf_login");
  }

  async function loadLocalTree() {
    setLoadingLocal(true);

    const res = await fetch(`/api/docs/list?login=${login}`);
    const data = await res.json();

    const local = data.docs.find((x) => x.name === "local-workspace");
    setLocalTree(local);

    setLoadingLocal(false);
  }

  async function loadGithubTree() {
    setLoadingGithub(true);

    const res = await fetch(`/api/docs/list?login=${login}`);
    const data = await res.json();

    const github = data.docs.find((x) => x.name !== "local-workspace");
    setGithubTree(github);

    setLoadingGithub(false);
  }

  // -----------------------------
  // START DEVICE FLOW
  // -----------------------------
  async function startGitHubLogin() {
    const res = await fetch("http://localhost:4000/api/auth/device/start", {
      method: "POST",
    });
    const data = await res.json();

    setUserCode(data.user_code);
    setVerificationUri(data.verification_uri);
    setAuthStep("polling");

    pollForAuth(data.device_code, data.interval);
  }

  // -----------------------------
  // POLL FOR AUTH COMPLETION
  // -----------------------------
  async function pollForAuth(deviceCode: string, interval: number) {
    const poll = async () => {
      const res = await fetch("http://localhost:4000/api/auth/device/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: deviceCode }),
      });

      const data = await res.json();

      if (data.status === "ok" && data.login) {
        setLogin(data.login);
        localStorage.setItem("rf_login", data.login);
        setIsAuthenticated(true);
        setAuthStep("idle");
        return;
      }

      if (data.error === "authorization_pending") {
        setTimeout(poll, interval * 1000);
        return;
      }

      if (data.error === "slow_down") {
        setTimeout(poll, (interval + 2) * 1000);
        return;
      }

      //console.error("Auth error:", data);
    };

    poll();
  }

  // -----------------------------
  // FILE OPERATIONS
  // -----------------------------
  function saveLocal() {
    fetch(
      `http://localhost:4000/api/docs/save?login=${encodeURIComponent(login)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: currentDocPath,
          content,
          commitMessage,
          email,
        }),
      },
    );
  }

  function renameFileOnBackend(oldPath: string, newPath: string) {
    return fetch("http://localhost:4000/api/docs/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPath, newPath }),
    });
  }

  function submitPR() {
    fetch("http://localhost:4000/api/docs/submit-pr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: currentDocPath,
        content,
        commitMessage,
        prBody,
        branch,
        email,
      }),
    }).then((res) => res.json());
  }

  async function refreshDocsList() {
    const res = await fetch(`/api/docs/list?login=${login}`);
    const data = await res.json();
    setTree(data.docs);
  }

  async function handleCloneToLocal() {
    const res = await fetch(
      `http://localhost:4000/api/docs/clone-to-local?login=${encodeURIComponent(login)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pendingGitHubPath }),
      },
    );

    const data = await res.json();

    // Compute workspace image folder
    const clean = pendingGitHubPath.replace(/^docs\//, "");
    const folder = clean.replace(/[^/]+$/, "") + "img";
    setEditorImageFolder(folder);

    // Load the new local file
    await loadDoc(data.localPath);

    // ⭐ MUST happen immediately after loadDoc
    setCurrentDocPath(data.localPath);

    // Refresh ONLY the local workspace tree
    await refreshLocalWorkspace();

    // Collapse GitHub docs tree
    setOpenFolders((prev) => ({
      ...prev,
      docs: false,
    }));

    // Expand local-workspace tree
    setOpenFolders((prev) => ({
      ...prev,
      "local-workspace": true,
    }));

    // Expand the folder containing the file
    const parentFolder = clean.replace(/[^/]+$/, "").replace(/\/$/, "");
    if (parentFolder) {
      setOpenFolders((prev) => ({
        ...prev,
        [`local-workspace/${parentFolder}`]: true,
      }));
    }

    setShowEditModal(false);
  }

  // -----------------------------
  // LOAD DOCUMENT Trees
  // -----------------------------

  async function loadDocsTree() {
    const res = await fetch(`/api/docs/list?login=${login}`);
    const data = await res.json();

    const github = data.docs.find((x) => x.name !== "local-workspace");
    const local = data.docs.find((x) => x.name === "local-workspace");

    setGithubTree(github);
    setLocalTree(local);
  }

  // async function loadLocalTree() {
  //   const res = await fetch(`/api/docs/list?login=${login}`);
  //   const data = await res.json();

  //   const local = data.docs.find((x) => x.name === "local-workspace");
  //   setLocalTree(local);
  // }

  async function loadGithubTree() {
    setLoadingGithub(true); // optional but clean

    const res = await fetch(`/api/docs/list?login=${login}`);
    const data = await res.json();

    const github = data.docs.find((x) => x.name !== "local-workspace");
    setGithubTree(github);
    setLoadingGithub(false);
  }

  async function refreshLocalWorkspace() {
    const res = await fetch(`/api/docs/list?login=${login}`);
    const data = await res.json();

    const local = data.docs.find((x) => x.name === "local-workspace");
    setLocalTree(local);
  }

  // -----------------------------
  // LOAD DOCUMENT
  // -----------------------------
  function loadDoc(path: string) {
    // 🔥 Intercept GitHub files before loading them
    console.log("📄 [loadDoc] Requested path:", path);
    if (path.startsWith("docs/")) {
      setShowEditModal(true);
      setPendingGitHubPath(path);
    } else {
      // Local file → hide modal
      setShowEditModal(false);
    }

    setCurrentDocPath(path);

    fetch(
      `http://localhost:4000/api/docs/load?path=${encodeURIComponent(path)}&login=${encodeURIComponent(login)}`,
    )
      .then((res) => res.json())
      .then((data) => {
        setContent(data.content);
      });
  }

  // -----------------------------
  // DRAG / RESIZE
  // -----------------------------
  function startDrag() {
    dragging.current = true;
  }

  function stopDrag() {
    dragging.current = false;
  }

  function onDrag(e: MouseEvent) {
    if (!dragging.current) return;
    const pct = (e.clientX / window.innerWidth) * 100;
    // if (pct > 35 && pct < 80) setEditorWidth(pct);
  }

  useEffect(() => {
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", stopDrag);
    return () => {
      window.removeEventListener("mousemove", onDrag);
      window.removeEventListener("mouseup", stopDrag);
    };
  }, []);

  function handleDrop(folderPath: string) {
    if (!draggedItem) return;

    // Creating a new page
    if (draggedItem === "__NEW_PAGE__") {
      const newPath = `${folderPath}/new-file.mdx`;
      setCurrentDocPath(newPath);
      setContent(newDocTemplate);
      setDraggedItem(null);
      return;
    }

    // Moving an existing file
    const filename = draggedItem.split("/").pop();
    const newPath = `${folderPath}/${filename}`;

    renameFileOnBackend(draggedItem, newPath);
    setDraggedItem(null);
  }

  // VERSION GATE — safe and correct
  if (!editorStatus) {
    // still loading version info
    return null;
  }

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
        //      onContinue={() => setEditorStatus({ type: "ok" })}
        onContinue={() => {
          const timeout = Date.now() + 60 * 1000;
          //const timeout = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
          localStorage.setItem("rf_dismissed_until", timeout.toString());
          setEditorStatus({ type: "ok" });
        }}
      />
    );
  }

  // -----------------------------
  // AUTH GATE
  // -----------------------------
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

            <p style={{ marginTop: "0.5rem" }}>Waiting for authorization…</p>
          </div>
        )}
      </div>
    );
  }

  const onSelect = (path: string) => {
    const isImage = /\.(png|jpe?g|gif|svg|webp)$/i.test(path);

    if (isImage) {
      setEditorWidth(0); // collapse editor
    } else {
      setEditorWidth(50); // restore editor
    }

    loadDoc(path);
  };

  function onDropFolder(targetFolderPath: string) {
    if (!draggedItem) return;
    renameFileOnBackend(
      draggedItem,
      `${targetFolderPath}/${draggedItem.split("/").pop()}`,
    ).then(() => refreshLocalWorkspace());
    setDraggedItem(null);
  }

  function LoadingBanner({ message }) {
    return (
      <div className="loading-banner">
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

  // -----------------------------
  // MAIN RETURN (AUTHENTICATED UI)
  // -----------------------------
  return (
    <>
      {editorStatus && editorStatus.type === "updateAvailable" && (
        <UpdateBanner {...editorStatus} />
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
        {/* LEFT SIDEBAR */}
        <div
          style={{
            width: "300px",
            borderRight: "1px solid #ccc",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <h3>Docs</h3>

          {loadingLocal && (
            <LoadingBanner message="Please wait… Loading local workspace" />
          )}

          {!loadingLocal && loadingGithub && (
            <LoadingBanner message="Please wait… Loading docs from GitHub" />
          )}

          <div style={{ flex: 1, overflowY: "auto" }}>
            <div
              draggable
              onDragStart={() => setDraggedItem("__NEW_PAGE__")}
              className="new-page-draggable new-page-btn"
            >
              + New Page (drag into folder)
            </div>

            {localTree && (
              <Tree
                nodes={[localTree]}
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

          <div className="commit-panel" style={{ marginTop: "1rem" }}>
            <input
              type="text"
              placeholder="Commit message"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />

            <textarea
              placeholder="PR description (optional)"
              value={prBody}
              onChange={(e) => setPrBody(e.target.value)}
            />

            <div className="row" style={{ display: "flex", gap: "0.75rem" }}>
              <input
                type="text"
                placeholder="Branch name"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />

              <input
                type="text"
                placeholder="Author email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div
              className="buttons"
              style={{ display: "flex", gap: "0.75rem" }}
            >
              <button onClick={saveLocal}>Save to Local</button>
              <button onClick={submitPR}>Submit PR</button>
            </div>
          </div>
        </div>

        {/* EDITOR + PREVIEW */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* EDITOR */}
          <div
            className="editor-container"
            style={{
              width: `${editorWidth}%`,
              padding: "1rem",
              borderRight: "1px solid #ddd",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              position: "relative",
              minWidth: "420px",
            }}
          >
            {showEditModal && (
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
                    <button onClick={handleCloneToLocal}>Edit this file</button>
                  </div>
                </div>
              </div>
            )}

            <h3>Editor</h3>

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

          {/* DRAG HANDLE */}
          <div
            onMouseDown={startDrag}
            style={{
              width: "6px",
              cursor: "col-resize",
              background: "#eee",
            }}
          />

          {/* PREVIEW */}
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
