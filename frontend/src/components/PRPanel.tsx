// PRPanel.tsx

import { useState } from "react";
import { useGitPR } from "../hooks/useGitPR";
import { PRDescriptionModal } from "./PRDescriptionModal";

// Module-level, not a default parameter: a default parameter value is a
// fresh function on every render, which made PRDescriptionModal's
// upstream-check effect (which depends on this prop's identity) think
// something relevant had changed and re-run on every PRPanel re-render
// while the modal was open — not just on a genuine open/close transition.
function warnNoConflictUI(conflicts: unknown[]) {
  console.warn(
    "Pre-submit rebase found upstream conflicts, but PRPanel has no conflict UI wired up:",
    conflicts,
  );
}

export function PRPanel({
  login,
  workspace,
  onConflictsDetected = warnNoConflictUI,
}) {
  const [modalOpen, setModalOpen] = useState(false);

  // FIX: pass login + workspace into the hook
  const { banner, activePR, submitPR, submitting, clearBanner } = useGitPR({
    login,
    workspace,
  });

  const handleOpenModal = () => setModalOpen(true);

  const handleSubmitDescription = async (description: string) => {
    setModalOpen(false);
    await submitPR(description);
  };

  return (
    <div className="pr-panel">
      {banner && (
        <div className={`banner${banner.type === "error" ? " banner-error" : ""}`}>
          {banner.type === "pr_created" && (
            <>
              Pull Request #{banner.prNumber} created.
              {banner.url && (
                <>
                  {" "}
                  <a href={banner.url} target="_blank" rel="noreferrer">
                    View on GitHub
                  </a>
                </>
              )}
            </>
          )}
          {banner.type === "pr_updated" && (
            <>
              Pull Request #{banner.prNumber} updated.
              {banner.url && (
                <>
                  {" "}
                  <a href={banner.url} target="_blank" rel="noreferrer">
                    View on GitHub
                  </a>
                </>
              )}
            </>
          )}
          {banner.type === "pr_merged" && (
            <>Pull Request #{banner.prNumber} merged. Workspace reset.</>
          )}
          {banner.type === "pr_closed" && (
            <>Pull Request #{banner.prNumber} closed. Workspace reset.</>
          )}
          {banner.type === "error" && <>Failed to submit PR: {banner.error}</>}
          <button onClick={clearBanner}>×</button>
        </div>
      )}

      {activePR && <div className="active-pr">Working on PR #{activePR}</div>}

      <button className="submit-pr" onClick={handleOpenModal} disabled={submitting}>
        {submitting ? "Submitting…" : activePR ? "Update PR" : "Set up PR"}
      </button>

      <PRDescriptionModal
        isOpen={modalOpen}
        onSubmit={handleSubmitDescription}
        onCancel={() => setModalOpen(false)}
        login={login}
        workspace={workspace}
        onConflictsDetected={onConflictsDetected}
      />
    </div>
  );
}
