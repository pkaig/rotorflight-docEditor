import { useEffect, useState, useRef } from "react";
import PreviewErrorBoundary from "./PreviewErrorBoundary";
import Preview from "./Preview";

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

function Tree({
  nodes,
  onSelect,
}: {
  nodes: TreeNode[];
  onSelect: (path: string) => void;
}) {
  return (
    <ul style={{ listStyle: "none", paddingLeft: 12 }}>
      {nodes.map((node) => (
        <li key={node.path}>
          {node.type === "dir" ? (
            <details>
              <summary>{node.name}</summary>
              <Tree nodes={node.children || []} onSelect={onSelect} />
            </details>
          ) : (
            <button
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "#0070f3",
              }}
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
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [content, setContent] = useState("");
  const [editorWidth, setEditorWidth] = useState(50);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const dragging = useRef(false);

  const [currentDocPath, setCurrentDocPath] = useState("");

  useEffect(() => {
    fetch("http://localhost:4000/api/docs/list")
      .then((res) => res.json())
      .then((data) => setTree(buildTree(data.docs)));
  }, []);

  function loadDoc(path: string) {
    setCurrentDocPath(path);

    fetch(`http://localhost:4000/api/docs/load?path=${path}`)
      .then((res) => res.json())
      .then((data) => {
        console.log("Loaded content:", data.content.slice(0, 200));
        setContent(data.content);
      });
  }

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

  console.log(
    "PARENT → Preview props:",
    "content type:",
    typeof content,
    "isNull:",
    content === null,
    "isUndefined:",
    content === undefined,
    "length:",
    typeof content === "string" ? content.length : "n/a",
  );

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div
        style={{
          width: "300px",
          borderRight: "1px solid #ccc",
          padding: "1rem",
          overflowY: "auto",
        }}
      >
        <h3>Docs</h3>
        <Tree nodes={tree} onSelect={loadDoc} />
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div
          style={{
            width: `${editorWidth}%`,
            padding: "1rem",
            overflowY: "auto",
            borderRight: "1px solid #ddd",
          }}
        >
          <h3>Editor</h3>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            style={{
              width: "100%",
              height: "calc(100vh - 120px)",
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

        <div
          onMouseDown={startDrag}
          style={{
            width: "6px",
            cursor: "col-resize",
            background: "#eee",
          }}
        />

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
  );
}
