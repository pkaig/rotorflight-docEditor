import { useEffect, useState, useRef } from "react";
import PreviewErrorBoundary from "./PreviewErrorBoundary";
import Preview from "./Preview";
import newDocTemplate from "../templates/newDocTemplate.mdx?raw";

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

function buildTree(docs: DocItem[]): TreeNode[] {
  const root: Record<string, any> = {};

  docs.forEach((doc) => {
    const parts = doc.path.split("/");
    let current = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;

      if (!current[part]) {
        current[part] = {
          name: part,
          path: parts.slice(0, index + 1).join("/"),
          type: isFile ? "file" : "dir",
          children: isFile ? undefined : {},
        };
      }

      current = current[part].children || current;
    });
  });

  function normalize(node: Record<string, any>): TreeNode[] {
    return Object.values(node).map((n) => ({
      ...n,
      children: n.children ? normalize(n.children) : undefined,
    }));
  }

  return normalize(root);
}

function Tree({ nodes, onSelect, onDropFolder, setDraggedItem }) {
  return (
    <ul className="tree-list">
      {nodes.map((node) => (
        <li key={node.path}>
          {node.type === "dir" ? (
            <details className="tree-dir" open>
              <div
                className="tree-folder"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDropFolder(node.path)}
              >
                {node.name}
              </div>

              <Tree
                nodes={node.children || []}
                onSelect={onSelect}
                onDropFolder={onDropFolder}
                setDraggedItem={setDraggedItem}
              />
            </details>
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
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [content, setContent] = useState("");
  const [editorWidth, setEditorWidth] = useState(50);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const dragging = useRef(false);

  const [currentDocPath, setCurrentDocPath] = useState("");

  const [commitMessage, setCommitMessage] = useState("");
  const [prBody, setPrBody] = useState("");
  const [branch, setBranch] = useState("");
  const [email, setEmail] = useState("");

  const [loadingDocs, setLoadingDocs] = useState(true);

  const [user, setUser] = useState<{
    login: string;
    name: string;
    avatar_url: string;
  } | null>(null);

  // Authentication
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authStep, setAuthStep] = useState<"idle" | "waiting" | "polling">(
    "idle",
  );
  const [userCode, setUserCode] = useState("");
  const [verificationUri, setVerificationUri] = useState("");

  // Drag state
  const [draggedItem, setDraggedItem] = useState<string | null>(null);

  // -----------------------------
  // AUTH FUNCTIONS
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

  async function pollForAuth(deviceCode: string, interval: number) {
    const poll = async () => {
      const res = await fetch("http://localhost:4000/api/auth/device/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: deviceCode }),
      });

      const data = await res.json();

      if (data.status === "ok") {
        setIsAuthenticated(true);
        setAuthStep("idle");

        // Fetch user info
        fetch("http://localhost:4000/api/auth/me")
          .then((res) => res.json())
          .then((data) => setUser(data));

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

      console.error("Auth error:", data);
    };

    poll();
  }

  // -----------------------------
  // FILE OPERATIONS
  // -----------------------------
  function saveLocal() {
    fetch("http://localhost:4000/api/docs/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: currentDocPath,
        content,
        commitMessage,
        email,
      }),
    })
      .then((res) => res.json())
      .then((data) => console.log("Saved locally:", data));
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
    })
      .then((res) => res.json())
      .then((data) => console.log("PR submitted:", data));
  }

  // -----------------------------
  // INITIAL DOC LOAD
  // -----------------------------
  useEffect(() => {
    setLoadingDocs(true);

    fetch("http://localhost:4000/api/docs/list")
      .then((res) => res.json())
      .then((data) => {
        setTree(buildTree(data.docs));
        setLoadingDocs(false);
      })
      .catch(() => {
        setLoadingDocs(false);
      });
  }, []);

  // -----------------------------
  // LOAD DOCUMENT
  // -----------------------------
  function loadDoc(path: string) {
    setCurrentDocPath(path);

    fetch(`http://localhost:4000/api/docs/load?path=${path}`)
      .then((res) => res.json())
      .then((data) => setContent(data.content));
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
    if (pct > 20 && pct < 80) setEditorWidth(pct);
  }

  useEffect(() => {
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", stopDrag);
    return () => {
      window.removeEventListener("mousemove", onDrag);
      window.removeEventListener("mouseup", stopDrag);
    };
  }, []);

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

  // -----------------------------
  // MAIN RETURN (AUTHENTICATED UI)
  // -----------------------------
  return (
    <>
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

          {loadingDocs && (
            <div
              style={{
                padding: "0.5rem 0.75rem",
                marginBottom: "0.75rem",
                background: "#fff3cd",
                border: "1px solid #ffeeba",
                borderRadius: "4px",
                color: "#856404",
                fontSize: "0.9rem",
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
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
              <span>Please wait… Loading docs from GitHub</span>
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto" }}>
            <div
              draggable
              onDragStart={() => setDraggedItem("__NEW_PAGE__")}
              className="new-page-draggable new-page-btn"
            >
              + New Page (drag into folder)
            </div>

            <Tree
              nodes={tree}
              onSelect={loadDoc}
              onDropFolder={handleDrop}
              setDraggedItem={setDraggedItem}
            />
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
            style={{
              width: `${editorWidth}%`,
              padding: "1rem",
              borderRight: "1px solid #ddd",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
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
