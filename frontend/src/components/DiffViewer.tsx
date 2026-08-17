/* frontend/src/components/DiffViewer.tsx
 *
 * Description of responsibility:
 *   Read-only side panel showing a line diff between a file's current
 *   workspace content and its mirror baseline, fetched from
 *   /api/reset-mirror/diff-file.
 *
 * Info:
 *   Superseded in the main layout by UnifiedDiffViewer.tsx (App.tsx
 *   renders that one instead), but kept as a working alternate diff
 *   presentation. The `if (!file || !workspace)` early-return JSX
 *   deliberately comes after the effect and its hooks, not before — an
 *   early return above a hook call would violate React's rules of
 *   hooks.
 */
import { diffLines } from "diff";
import { useEffect, useState } from "react";

interface DiffViewerProps {
  login: string | null;
  workspace: string | null;
  file: string;
  onClose: () => void;
}

export default function DiffViewer({
  login,
  workspace,
  file,
  onClose,
}: DiffViewerProps) {
  const [workspaceText, setWorkspaceText] = useState("");
  const [baselineText, setBaselineText] = useState("");

  console.log(file, workspace);

  useEffect(() => {
    if (!file || !workspace) return;

    async function load() {
      const res = await fetch(
        `/api/reset-mirror/diff-file?login=${login}&workspace=${workspace}&file=${file}`,
      );
      const json = await res.json();

      setWorkspaceText(json.workspace || "");
      setBaselineText(json.baseline || "");
    }
    load();
  }, [file, workspace, login]);

  if (!file || !workspace) {
    return (
      <div style={{ padding: "1rem" }}>
        No file selected.
        <button onClick={onClose}>Close</button>
      </div>
    );
  }

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
