import { diffLines } from "diff";
import { useEffect, useState } from "react";

export default function DiffViewer({ login, workspace, file, onClose }) {
  const [workspaceText, setWorkspaceText] = useState("");
  const [baselineText, setBaselineText] = useState("");

  console.log(file, workspace);
  if (!file || !workspace) {
    return (
      <div style={{ padding: "1rem" }}>
        No file selected.
        <button onClick={onClose}>Close</button>
      </div>
    );
  }

  useEffect(() => {
    async function load() {
      const res = await fetch(
        `/api/reset-mirror/diff-file?login=${login}&workspace=${workspace}&file=${file}`,
      );
      const json = await res.json();

      setWorkspaceText(json.workspace || "");
      setBaselineText(json.baseline || "");
    }
    load();
  }, [file]);

  const diffs = diffLines(baselineText || "", workspaceText || "");

  return (
    <div style={{ padding: "1rem" }}>
      <h3>Changes in {file}</h3>

      <div style={{ fontFamily: "monospace", border: "1px solid #ccc" }}>
        {diffs.map((part, i) => (
          <div
            key={i}
            style={{
              background: part.added
                ? "#e6f7ff"
                : part.removed
                  ? "#ffe6e6"
                  : "white",
              padding: "4px 8px",
              whiteSpace: "pre-wrap",
              borderBottom: "1px solid #eee",
            }}
          >
            {part.value}
          </div>
        ))}
      </div>

      {/* <button onClick={onClose} style={{ marginTop: "1rem" }}>
        Close Diff
      </button> */}
    </div>
  );
}
