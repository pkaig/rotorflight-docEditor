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
    <div style={{ padding: "1rem" }}>
      <h3>Changes in {file}</h3>

      <div
        style={{
          fontFamily: "monospace",
          border: "1px solid #ccc",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        {diffs.map((part, i) => {
          const bg = part.added
            ? "#e6ffed" // green
            : part.removed
              ? "#ffeef0" // red
              : "white";

          const prefix = part.added ? "+" : part.removed ? "-" : " ";

          return (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                overflow: "hidden",
              }}
            >
              {/* Fixed toolbar */}
              <div
                style={{
                  padding: "0.5rem 1rem",
                  borderBottom: "1px solid #ccc",
                  background: "#fafafa",
                  flexShrink: 0,
                }}
              >
                <strong>Changes in {file}</strong>
                <button onClick={onClose} style={{ marginLeft: "1rem" }}>
                  Close Diff
                </button>
              </div>

              {/* Scrollable diff content */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "1rem",
                  paddingBottom: "1rem",
                  fontFamily: "monospace",
                }}
              >
                {diffs.map((part, i) => {
                  const bg = part.added
                    ? "#e6ffed"
                    : part.removed
                      ? "#ffeef0"
                      : "white";

                  const prefix = part.added ? "+" : part.removed ? "-" : " ";

                  return (
                    <div
                      key={i}
                      style={{
                        background: bg,
                        padding: "2px 8px",
                        whiteSpace: "pre-wrap",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      {part.value.split("\n").map((line, idx) =>
                        line.length > 0 ? (
                          <div key={idx}>
                            <span style={{ opacity: 0.6 }}>{prefix}</span>{" "}
                            {line}
                          </div>
                        ) : null,
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
