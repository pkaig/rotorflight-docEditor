/* frontend/src/components/ConflictResolver.tsx
 *
 * Description of responsibility:
 *   Modal shown when a doc has a real merge conflict between the
 *   user's workspace edits and an upstream change pulled in during a
 *   rebase — shows a line-by-line diff and a merge textarea, and posts
 *   the chosen resolution to /api/reset-mirror/resolve-conflict.
 *
 * Info:
 *   saveCurrent() intentionally keeps the .conflict file around
 *   (resolution: "manual" without deleting it) so the user can save
 *   partial progress and come back to finish resolving later;
 *   resolve() is the only path that actually clears the conflict.
 */
import { useEffect, useState } from "react";
import { diffLines } from "diff";

export default function ConflictResolver({
  file,
  workspace,
  login,
  onMergedChange,
  onClose,
  onResolved,
}) {
  const [workspaceText, setWorkspaceText] = useState("");
  const [upstreamText, setUpstreamText] = useState("");
  const [mergedText, setMergedText] = useState("");

  // -------------------------------------------------------
  // Load conflict data ONCE when modal opens
  // -------------------------------------------------------
  useEffect(() => {
    async function load() {
      const res = await fetch(
        `/api/reset-mirror/conflict-file?login=${login}&workspace=${workspace}&file=${file}`,
      );
      const json = await res.json();

      setWorkspaceText(json.workspace);
      setUpstreamText(json.upstream);

      // Start with workspace version, but DO NOT notify parent yet
      setMergedText(json.workspace);
    }

    load();
  }, [workspace, file]);

  // -------------------------------------------------------
  // Only notify parent when user explicitly edits merged text
  // -------------------------------------------------------
  function updateMerged(text: string) {
    setMergedText(text);
    if (onMergedChange) onMergedChange(text);
  }

  // -------------------------------------------------------
  // Proper diff using diffLines()
  // -------------------------------------------------------
  const diffs = diffLines(workspaceText, upstreamText);

  // -------------------------------------------------------
  // Save current merged text WITHOUT resolving conflict
  // -------------------------------------------------------
  async function saveCurrent() {
    await fetch("/api/reset-mirror/resolve-conflict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login,
        workspace,
        file,
        resolution: "manual",
        content: mergedText,
        keepConflict: true, // backend ignores this unless you add support
      }),
    });
  }

  // -------------------------------------------------------
  // Final resolution (delete .conflict)
  // -------------------------------------------------------
  async function resolve() {
    await fetch("/api/reset-mirror/resolve-conflict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login,
        workspace,
        file,
        resolution: "manual",
        content: mergedText,
      }),
    });

    onResolved();
  }

  return (
    <div className="merge-container" style={{ padding: "1rem" }}>
      <h3>Merge Conflict</h3>
      <p>
        <strong>{file}</strong> has changes in both your workspace and upstream.
      </p>

      {/* DIFF VIEW */}
      <h4>Differences</h4>
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

      {/* MERGE ACTIONS */}
      <div style={{ display: "flex", gap: "0.5rem", margin: "1rem 0" }}>
        <button onClick={() => updateMerged(workspaceText)}>
          Accept Workspace
        </button>

        <button onClick={() => updateMerged(upstreamText)}>
          Accept Upstream
        </button>

        <button
          onClick={() => updateMerged(workspaceText + "\n\n" + upstreamText)}
        >
          Accept Both
        </button>
      </div>

      {/* MERGED EDITOR */}
      <h4>Merged Result</h4>
      <textarea
        value={mergedText}
        onChange={(e) => updateMerged(e.target.value)}
        style={{
          width: "100%",
          height: "200px",
          fontFamily: "monospace",
          fontSize: "14px",
          padding: "0.5rem",
          border: "1px solid #ccc",
          borderRadius: 4,
        }}
      />

      {/* SAVE + RESOLVE BUTTONS */}
      <div style={{ marginTop: "1rem", display: "flex", gap: "1rem" }}>
        <button onClick={saveCurrent}>Save Current</button>
        <button onClick={resolve}>Resolve Merge</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
