/* frontend/src/components/UnifiedDiffViewer.tsx
 *
 * Description of responsibility:
 *   The diff panel actually rendered by App.tsx when "Show Diff" is
 *   toggled — shows a unified (single-column, +/- prefixed) line diff
 *   between a file's workspace content and its mirror baseline.
 *
 * Info:
 *   The `if (!file || !workspace) return;` guard lives inside the
 *   effect, not before the hook calls above it — React requires the
 *   same hooks to run in the same order on every render, so bailing
 *   out before useEffect ran would be a rules-of-hooks violation, even
 *   though file/workspace are already guaranteed non-empty by the time
 *   this actually mounts today.
 */
import { diffLines } from "diff";
import { useEffect, useState } from "react";

interface UnifiedDiffViewerProps {
  login: string | null;
  workspace: string | null;
  file: string;
  onClose: () => void;
  // Forwarded straight through to .diff-scroll — App.tsx's
  // useDiffPreviewScrollSync needs the real DOM node to read/drive
  // scrollTop against, the same way the editor/preview pair's own sync
  // needs the textarea (see EditorPanel's textareaRef).
  scrollRef?: React.Ref<HTMLDivElement>;
}

export default function UnifiedDiffViewer({
  login,
  workspace,
  file,
  onClose,
  scrollRef,
}: UnifiedDiffViewerProps) {
  const [workspaceText, setWorkspaceText] = useState("");
  const [baselineText, setBaselineText] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Guard lives inside the effect, not before the hook calls above —
    // React requires every hook to run in the same order on every render,
    // so bailing out early up there (before useEffect ran) was a
    // rules-of-hooks violation, even though file/workspace are already
    // guaranteed non-empty by the time this actually mounts today.
    if (!file || !workspace) return;

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
  }, [file, workspace, login]);

  // Guard against missing file/workspace
  if (!file || !workspace) {
    return (
      <div style={{ padding: "1rem" }}>
        No file selected.
        <button onClick={onClose}>Close Diff</button>
      </div>
    );
  }

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

      <div className="diff-scroll" ref={scrollRef}>
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
