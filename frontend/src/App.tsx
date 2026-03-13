import "./App.css";
import { useEffect, useState, useRef } from "react";
import PreviewErrorBoundary from "./PreviewErrorBoundary";
import Preview from "./Preview";
import newDocTemplate from "../templates/newDocTemplate.mdx?raw";
import { useAutosave } from "./hooks/useAutosave";
import { useGitPR } from "./useGitPR";
import { PRPanel } from "./PRPanel";
import {
  MaintenanceModal,
  ForceUpdateModal,
  UpdateAvailableModal,
} from "./versionModals";

const HASH_KEY = "rf_github_hash";
const TREE_KEY = "rf_github_tree";
const APP_VERSION = "1.4.2";

/* -------------------------------------------------------
   Types
------------------------------------------------------- */
type TreeNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
};

/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */
function isLocalPath(p: string) {
  return p?.startsWith("local-workspace/") || p?.startsWith("local/");
}

function normalizeLocalPath(p: string) {
  return p?.replace(/^local-workspace\//, "").replace(/^local\//, "");
}

/* -------------------------------------------------------
   Tree Component
------------------------------------------------------- */
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
                  "tree-folder folder-root " +
                  (node.name === "local-workspace" ? "folder-local" : "") +
                  (node.name === "Rotorflight-docs" ? "folder-docs" : "")
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

/* -------------------------------------------------------
   Main App Component
------------------------------------------------------- */
export default function App() {
  /* Core editor state */
  const [content, setContent] = useState("");
  const [currentDocPath, setCurrentDocPath] = useState("");
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [editorWidth, setEditorWidth] = useState(50);

  /* Commit / PR state */
  const [commitMessage, setCommitMessage] = useState("");
  const [prBody, setPrBody] = useState("");
  const [branch, setBranch] = useState("");
  const [email, setEmail] = useState("");

  /* Tree + drag state */
  const [openFolders, setOpenFolders] = useState({});
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const dragging = useRef(false);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileFolder, setNewFileFolder] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");

  const [localTree, setLocalTree] = useState<TreeNode | null>(null);
  const [githubTree, setGithubTree] = useState<TreeNode | null>(null);
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [loadingGithub, setLoadingGithub] = useState(true);

  /* User (for avatar / header) */
  const [user, setUser] = useState<{
    login: string;
    name: string;
    avatar_url: string;
  } | null>(null);

  /* Auth state */
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authStep, setAuthStep] = useState<"idle" | "waiting" | "polling">(
    "idle",
  );
  const [login, setLogin] = useState<string | null>(null);
  const [userCode, setUserCode] = useState("");
  const [verificationUri, setVerificationUri] = useState("");

  /* GitHub clone modal */
  const [showEditModal, setShowEditModal] = useState(false);
  const [isSyncingImages, setIsSyncingImages] = useState(false);

  const [pendingGitHubPath, setPendingGitHubPath] = useState("");
  const [editorImageFolder, setEditorImageFolder] = useState<string | null>(
    null,
  );

  function refreshGitHubTree() {
    fetch(`/api/docs/list?login=${login}`)
      .then((res) => res.json())
      .then((data) => {
        setGithubTree(data.docs.find((x) => x.name === "Rotorflight-docs"));
      });
  }

  function clearEditor() {
    setContent("");
    setCurrentDocPath(null);
  }

  function openEditFileModal() {
    setShowEditModal(true);
  }

  /* Version gate */
  const [editorStatus, setEditorStatus] = useState<null | {
    type: "blocked" | "forceUpdate" | "updateAvailable" | "ok";
    message?: string;
    current?: string;
    latest?: string;
    downloadUrl?: string;
  }>(null);

  /* Autosave */
  const effectivePath = isLocalPath(currentDocPath) ? currentDocPath : "";

  const saving = useAutosave(
    login,
    effectivePath,
    content,
    async (path, content) => {
      const clean = normalizeLocalPath(path);

      await fetch(`/api/docs/save?login=${encodeURIComponent(login)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: clean, content }),
      });
    },
  );

  /* -------------------------------------------------------
     Restore login on mount
  ------------------------------------------------------- */
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
      .catch(() => {});
  }, []);

  /* -------------------------------------------------------
   Has the Rotorflight-docs changed?
   If so, invalidate cache and reload tree
------------------------------------------------------- */
  useEffect(() => {
    if (!isAuthenticated || !login) return;

    async function init() {
      console.log("🔍 Hash check starting…");

      const cachedHash = localStorage.getItem(HASH_KEY);
      const cachedTree = localStorage.getItem(TREE_KEY);

      const res = await fetch(
        `http://localhost:4000/api/docs/github-hash?login=${encodeURIComponent(login)}`,
      );

      if (!res.ok) {
        console.warn("⚠️ Failed to fetch GitHub hash");
        return;
      }

      const { hash: currentHash } = await res.json();
      console.log("📦 Current hash:", currentHash, "Cached:", cachedHash);

      if (cachedHash && cachedHash === currentHash && cachedTree) {
        console.log("🌳 Using cached GitHub tree");
        const parsed = JSON.parse(cachedTree);

        const githubRoot = parsed.find((n) => n.name === "Rotorflight-docs");
        const localRoot = parsed.find((n) => n.name === "local-workspace");

        setGithubTree(githubRoot || null);
        setLocalTree(localRoot || null);

        setLoadingGithub(false);
        setLoadingLocal(false);
        return;
      }

      console.log("🔄 Hash changed → refreshing GitHub tree");

      const treeRes = await fetch(
        `http://localhost:4000/api/docs/list?login=${encodeURIComponent(login)}`,
      );

      if (!treeRes.ok) {
        console.warn("⚠️ Failed to fetch GitHub tree");
        return;
      }

      const { docs } = await treeRes.json();

      localStorage.setItem(TREE_KEY, JSON.stringify(docs));
      localStorage.setItem(HASH_KEY, currentHash);

      const githubRoot = docs.find((n) => n.name === "Rotorflight-docs");
      const localRoot = docs.find((n) => n.name === "local-workspace");

      setGithubTree(githubRoot || null);
      setLocalTree(localRoot || null);

      setLoadingGithub(false);
      setLoadingLocal(false);
    }

    init();
  }, [isAuthenticated, login]);

  /* -------------------------------------------------------
     Git PR hooks
  ------------------------------------------------------- */
  const {
    banner,
    activePR,
    submitPR,
    notifyFileSaved,
    notifyFileRenamed,
    notifyFileDeleted,
    notifyFileCreated,
    editFile,
    clearBanner,
  } = useGitPR({
    refreshGitHubTree,
    clearEditor,
    openEditFileModal,
  });

  /* -------------------------------------------------------
     Load trees
  ------------------------------------------------------- */

  async function refreshLocalWorkspace() {
    const res = await fetch(`/api/docs/list?login=${login}`);
    const data = await res.json();
    setLocalTree(data.docs.find((x) => x.name === "local-workspace"));
  }

  /* -------------------------------------------------------
     Version gate check
  ------------------------------------------------------- */
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
      const dismissedUntil = localStorage.getItem("rf_dismissed_until");

      if (dismissedUntil && Date.now() < Number(dismissedUntil)) {
        setEditorStatus({ type: "ok" });
        return;
      }

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
        setEditorStatus({ type: "blocked", message: cfg.blockMessage });
        return;
      }

      if (compare(APP_VERSION, cfg.minSupportedVersion) < 0) {
        setEditorStatus({
          type: "forceUpdate",
          current: APP_VERSION,
          latest: cfg.latestVersion,
          message: cfg.updateMessage,
          downloadUrl: cfg.downloadUrl,
        });
        return;
      }

      if (compare(APP_VERSION, cfg.latestVersion) < 0) {
        setEditorStatus({
          type: "updateAvailable",
          current: APP_VERSION,
          latest: cfg.latestVersion,
          message: cfg.updateMessage,
          downloadUrl: cfg.downloadUrl,
        });
        return;
      }

      setEditorStatus({ type: "ok" });
    }

    checkStatus();
  }, []);

  /* -------------------------------------------------------
     GitHub device flow
  ------------------------------------------------------- */
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
    };

    poll();
  }

  /* -------------------------------------------------------
     File operations
  ------------------------------------------------------- */
  function saveLocal() {
    if (!isLocalPath(currentDocPath)) return;

    const clean = normalizeLocalPath(currentDocPath);

    fetch(`/api/docs/save?login=${encodeURIComponent(login)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: clean,
        content,
        commitMessage,
        email,
      }),
    });
  }

  function renameFileOnBackend(oldPath: string, newPath: string) {
    return fetch("http://localhost:4000/api/docs/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPath, newPath }),
    });
  }

  // function submitPR() {
  //   fetch("http://localhost:4000/api/docs/submit-pr", {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({
  //       path: currentDocPath,
  //       content,
  //       commitMessage,
  //       prBody,
  //       branch,
  //       email,
  //     }),
  //   });
  // }
  /* -------------------------------------------------------
     Clone GitHub file to local
  ------------------------------------------------------- */
  async function handleCloneToLocal() {
    setShowEditModal(false);
    const res = await fetch(
      `http://localhost:4000/api/docs/clone-to-local?login=${encodeURIComponent(login)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pendingGitHubPath }),
      },
    );

    const data = await res.json();

    const clean = pendingGitHubPath.replace(/^Rotorflight-docs\//, "");
    const folder = clean.replace(/[^/]+$/, "") + "img";
    setEditorImageFolder(folder);

    await loadDoc(data.localPath);
    setCurrentDocPath(data.localPath);

    await refreshLocalWorkspace();

    setOpenFolders((prev) => ({
      ...prev,
      docs: false,
      "local-workspace": true,
    }));

    const parentFolder = clean.replace(/[^/]+$/, "").replace(/\/$/, "");
    if (parentFolder) {
      setOpenFolders((prev) => ({
        ...prev,
        [`local-workspace/${parentFolder}`]: true,
      }));
    }
    setIsSyncingImages(false);
    setShowEditModal(false);
  }

  /* -------------------------------------------------------
     Load document
  ------------------------------------------------------- */
  function loadDoc(inputPath: string) {
    console.log("📄 [loadDoc] Requested path:", inputPath);

    const login = localStorage.getItem("rf_login");

    // --- 1. Normalize the path -----------------------------------------
    let normalized: string;

    // Local workspace
    if (inputPath.startsWith("local-workspace/")) {
      if (inputPath.startsWith("local-workspace/versioned_docs/")) {
        normalized = inputPath.replace(/^local-workspace\//, "");
      } else {
        //normalized = inputPath;
        normalized = inputPath.replace(/^local-workspace\//, "docs/");
      }
    }

    // GitHub docs
    else if (inputPath.startsWith("Rotorflight-docs/")) {
      // Pass through unchanged
      normalized = inputPath;
    }

    // Fallback: treat as GitHub path missing prefix
    else if (inputPath.startsWith("docs/")) {
      normalized = "Rotorflight-docs/" + inputPath;
    } else {
      console.warn("⚠️ Unknown path format, passing through:", inputPath);
      normalized = inputPath;
    }

    console.log("📁 [loadDoc] Normalized path:", normalized);

    // --- 2. Modal gating for GitHub files -------------------------------
    if (normalized.startsWith("Rotorflight-docs/")) {
      setShowEditModal(true);
      setPendingGitHubPath(normalized);
    } else {
      setShowEditModal(false);
    }

    // --- 3. Update state ------------------------------------------------
    setCurrentDocPath(normalized);
    console.log("📁 [loadDoc] Set currentDocPath:", normalized);

    // Save last opened local doc
    if (normalized.startsWith("local-workspace/")) {
      localStorage.setItem("rf_last_opened_doc", normalized);
    }

    // --- 4. Fetch from backend -----------------------------------------
    fetch(
      `http://localhost:4000/api/docs/load?path=${encodeURIComponent(
        normalized,
      )}&login=${encodeURIComponent(login)}`,
    )
      .then(async (res) => {
        if (!res.ok) {
          console.warn("⚠️ loadDoc failed:", normalized, res.status);

          if (res.status === 404) {
            const last = localStorage.getItem("rf_last_opened_doc");
            if (last === normalized) {
              localStorage.removeItem("rf_last_opened_doc");
            }
          }

          setContent("");
          setCurrentDocPath("");
          setShowEditModal(false);
          return null;
        }

        return res.json();
      })
      .then((data) => {
        if (!data) return;
        setContent(data.content || "");
      })
      .catch(() => {
        setContent("");
        setCurrentDocPath("");
        setShowEditModal(false);
      });
  }

  /* -------------------------------------------------------
     Drag / resize
  ------------------------------------------------------- */
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

  /* -------------------------------------------------------
     Version gate UI
  ------------------------------------------------------- */
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

  /* -------------------------------------------------------
     Auth gate
  ------------------------------------------------------- */
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

  /* -------------------------------------------------------
     Tree selection / drop handlers
  ------------------------------------------------------- */
  const onSelect = (path: string) => {
    const isImage = /\.(png|jpe?g|gif|svg|webp)$/i.test(path);

    if (isImage) {
      setEditorWidth(0);
    } else {
      setEditorWidth(50);
    }

    loadDoc(path);
  };

  function onDropFolder(targetFolderPath: string) {
    if (!draggedItem) return;

    // Creating a new page
    if (draggedItem === "__NEW_PAGE__") {
      setNewFileFolder(targetFolderPath);
      setNewFileName("");
      setShowNewFileModal(true);
      setDraggedItem(null);
      return;
    }

    // Moving an existing file
    const filename = draggedItem.split("/").pop();
    const newPath = `${targetFolderPath}/${filename}`;

    renameFileOnBackend(draggedItem, newPath).then(() =>
      refreshLocalWorkspace(),
    );
    setDraggedItem(null);
  }

  function LoadingLocalBanner({ message }) {
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

  function LoadingGithubBanner({ message }) {
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
  /* -------------------------------------------------------
     Main return (authenticated UI)
  ------------------------------------------------------- */
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

            <div className="edit-modal-buttons" style={{ marginTop: "1rem" }}>
              <button
                onClick={() => {
                  const safe = newFileName.trim().replace(/\s+/g, "-");
                  if (!safe) return;

                  const newPath = `${newFileFolder}/${safe}.mdx`;

                  setCurrentDocPath(newPath);
                  setContent(newDocTemplate);

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

      {/* Optional: if you have an UpdateBanner component */}
      {/* {editorStatus && editorStatus.type === "updateAvailable" && (
        <UpdateBanner {...editorStatus} />
      )} */}

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

            {localTree && (
              <Tree
                nodes={[localTree]}
                onSelect={onSelect}
                onDropFolder={onDropFolder}
                setDraggedItem={setDraggedItem}
                openFolders={openFolders}
                setOpenFolders={setOpenFolders}
                onDrop={(e) => {
                  e.preventDefault();
                  const payload = e.dataTransfer.getData("text/plain");
                  if (payload) setDraggedItem(payload);
                  if (node.path) onDropFolder(node.path);
                }}
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
            clearEditor={() => {
              setContent("");
              setCurrentDocPath(null);
            }}
            openEditFileModal={() => setShowEditFileModal(true)}
          />
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
                    <button
                      onClick={() => {
                        setIsSyncingImages(true);
                        handleCloneToLocal();
                      }}
                    >
                      Edit this file
                    </button>
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
                      Please wait while we sync to the <br></br>local-workspace…
                    </span>
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
