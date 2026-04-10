import { diffLines } from "diff";
import { useEffect, useState } from "react";

export default function UnifiedDiffViewer({ login, workspace, file, onClose }) {
  const [workspaceText, setWorkspaceText] = useState("");
  const [baselineText, setBaselineText] = useState("");
  const [loading, setLoading] = useState(true);

  // Guard against missing file/workspace
  if (!file || !workspace) {
    return (
      <div style={{ padding: "1rem" }}>
        No file selected.
        <button onClick={onClose}>Close Diff</button>
      </div>
    );
  }

  useEffect(() => {
    async function load() {
      setLoading(true);

      const res = await fetch(
        `/api/reset-mirror/diff-file?login=${login}&workspace=${workspace}&file=${file}`,
      );
      const json = await res.json();

      setWorkspaceText(json.workspace || "");
      setBaselineText(json.baseline || "");
      setLoading(false);
    }

    load();
  }, [file]);

  if (loading) {
    return <div style={{ padding: "1rem" }}>Loading diff…</div>;
  }

  const diffs = diffLines(baselineText || "", workspaceText || "");

  return (
    <div className="diff-root">
      <div className="diff-header">
        <strong>Changes in {file}</strong>
        <button onClick={onClose} style={{ marginLeft: "1rem" }}>
          Close Diff
        </button>
      </div>

      <div className="diff-scroll">
        {diffs.map((part, i) => {
          const cls = part.added
            ? "diff-line diff-added"
            : part.removed
              ? "diff-line diff-removed"
              : "diff-line diff-neutral";

          const prefix = part.added ? "+" : part.removed ? "-" : " ";

          return (
            <div key={i} className={cls}>
              {part.value.split("\n").map((line, idx) =>
                line.length > 0 ? (
                  <div key={idx}>
                    <span style={{ opacity: 0.6 }}>{prefix}</span> {line}
                  </div>
                ) : null,
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
