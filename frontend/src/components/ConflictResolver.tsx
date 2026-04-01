import { useEffect, useState } from "react";

export default function ConflictResolver({
  workspace,
  file,
  onResolved,
  onMergedChange,
}) {
  const [workspaceText, setWorkspaceText] = useState("");
  const [upstreamText, setUpstreamText] = useState("");
  const [mergedText, setMergedText] = useState("");

  useEffect(() => {
    async function load() {
      const res = await fetch(
        `/api/docs/conflict-file?workspace=${workspace}&file=${file}`,
      );
      const json = await res.json();

      setWorkspaceText(json.workspace);
      setUpstreamText(json.upstream);
      setMergedText(json.workspace); // start with workspace version
    }

    load();
  }, [workspace, file]);

  /* -------------------------------------------------------
    line-by-line diff for display purposes
    ------------------------------------------------------- */

  function diffLines(a: string, b: string) {
    const aLines = a.split("\n");
    const bLines = b.split("\n");

    const max = Math.max(aLines.length, bLines.length);
    const result = [];

    for (let i = 0; i < max; i++) {
      const left = aLines[i] ?? "";
      const right = bLines[i] ?? "";

      if (left === right) {
        result.push({ type: "same", left, right });
      } else {
        result.push({ type: "diff", left, right });
      }
    }

    return result;
  }

  const diffs = diffLines(workspaceText, upstreamText);

  /* -------------------------------------------------------
    notify parent (App.tsx) so preview updates live
    ------------------------------------------------------- */
  useEffect(() => {
    if (onMergedChange) onMergedChange(mergedText);
  }, [mergedText]);

  /* -------------------------------------------------------
    RESOLUTION LOGIC
    ------------------------------------------------------- */
  async function resolve(type) {
    const body =
      type === "manual"
        ? { workspace, file, resolution: "manual", content: mergedText }
        : { workspace, file, resolution: type };

    await fetch("/api/docs/resolve-conflict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    onResolved();
  }

  return (
    <div className="merge-container" style={{ padding: "1rem" }}>
      {/* DIFF VIEW */}
      <h4>Differences</h4>
      <div className="diff-container" style={{ fontFamily: "monospace" }}>
        {diffs.map((d, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              borderBottom: "1px solid #eee",
              background:
                d.type === "diff"
                  ? "linear-gradient(to right, #ffe6e6 50%, #e6f0ff 50%)"
                  : "white",
            }}
          >
            <div
              style={{
                flex: 1,
                padding: "4px 8px",
                whiteSpace: "pre-wrap",
              }}
            >
              {d.left}
            </div>
            <div
              style={{
                flex: 1,
                padding: "4px 8px",
                whiteSpace: "pre-wrap",
              }}
            >
              {d.right}
            </div>
          </div>
        ))}
      </div>

      {/* MERGE ACTIONS */}
      <div
        className="merge-actions"
        style={{ display: "flex", gap: "0.5rem", margin: "1rem 0" }}
      >
        <button onClick={() => setMergedText(workspaceText)}>
          Accept Workspace
        </button>

        <button onClick={() => setMergedText(upstreamText)}>
          Accept Upstream
        </button>

        <button
          onClick={() => setMergedText(workspaceText + "\n\n" + upstreamText)}
        >
          Accept Both
        </button>
      </div>

      {/* MERGED EDITOR */}
      <h4>Merged Result</h4>
      <textarea
        value={mergedText}
        onChange={(e) => setMergedText(e.target.value)}
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

      {/* FINAL RESOLUTION BUTTON */}
      <div style={{ marginTop: "1rem" }}>
        <button onClick={() => resolve("manual")}>Save Merge</button>
      </div>
    </div>
  );
}
