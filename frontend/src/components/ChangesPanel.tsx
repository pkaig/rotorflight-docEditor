/* frontend/src/components/ChangesPanel.tsx
 *
 * Description of responsibility:
 *   Renders the sidebar's list of pending local changes (added/
 *   modified/deleted/renamed files) with per-row checkboxes for the
 *   "clear selected" action and a click-to-open handler for each file.
 *
 * Info:
 *   Purely presentational — `changes` and `selectedChanges` are owned
 *   by App.tsx (via useGitPR), not local state here.
 *
 *   The root div is deliberately named "changes-rows", not
 *   "changes-panel" — App.tsx's own sidebar wrapper (the actual
 *   scroll-budget owner, via .changes-list-container) already uses the
 *   "changes-panel" class for its outer flex/max-height layout. Reusing
 *   that name here made this component's root div inherit that same
 *   max-height + overflow:hidden as a SECOND, nested box, which capped
 *   and hard-clipped the row list on its own regardless of how much
 *   scroll room the real outer container had — no amount of scrolling
 *   could reach rows past that inner cap.
 */
import type { Dispatch, SetStateAction } from "react";
import type { ChangeSet } from "../hooks/useGitPR";

interface ChangesPanelProps {
  changes: ChangeSet;
  selectedChanges: Record<string, boolean>;
  setSelectedChanges: Dispatch<SetStateAction<Record<string, boolean>>>;
  onOpenFile: (path: string) => void;
}

export function ChangesPanel({
  changes,
  selectedChanges,
  setSelectedChanges,
  onOpenFile, // ← NEW
}: ChangesPanelProps) {
  function toggle(path: string) {
    setSelectedChanges((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  }

  function Row({
    prefix,
    path,
    label,
  }: {
    prefix: string;
    path: string;
    label: string;
  }) {
    return (
      <div
        className="change-row"
        onClick={() => onOpenFile(path)} // ← open file on click
      >
        <label className="change-item">
          <input
            type="checkbox"
            checked={!!selectedChanges[path]}
            onChange={() => toggle(path)}
            onClick={(e) => e.stopPropagation()} // ← prevent checkbox click from opening file
          />
          <span>
            {prefix} {label}
          </span>
        </label>
      </div>
    );
  }

  return (
    <div className="changes-rows">
      <h4>Changes</h4>

      {changes.added.map((c) => (
        <Row key={c.path} prefix="+" path={c.path} label={c.path} />
      ))}

      {changes.modified.map((c) => (
        <Row key={c.path} prefix="•" path={c.path} label={c.path} />
      ))}

      {changes.deleted.map((c) => (
        <Row key={c.path} prefix="–" path={c.path} label={c.path} />
      ))}

      {changes.renamed.map((c) => (
        <Row
          key={c.path}
          prefix="↪"
          path={c.path}
          label={`${c.from} → ${c.path}`}
        />
      ))}
    </div>
  );
}
