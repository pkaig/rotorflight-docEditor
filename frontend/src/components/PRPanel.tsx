/* frontend/src/components/PRPanel.tsx
 *
 * Description of responsibility:
 *   Sidebar panel that shows the current PR status banner and the
 *   "Set up PR" / "Update PR" button, and opens PRDescriptionModal to
 *   collect a description before calling submitPR.
 *
 * Info:
 *   banner/activePR/submitPR/submitting/clearBanner are all passed
 *   down from App.tsx's single useGitPR() call rather than created
 *   here — see the note in App.tsx on why there must only ever be one
 *   instance of that hook. warnNoConflictUI is a module-level function
 *   (not an inline default parameter) specifically so its identity
 *   stays stable across renders; an inline default would be a new
 *   function every render, which made PRDescriptionModal's
 *   upstream-check effect (which depends on this prop) think something
 *   had changed and re-run on every PRPanel re-render while the modal
 *   was open.
 */
// PRPanel.tsx

import { useState } from "react";
import { PRDescriptionModal } from "./PRDescriptionModal";
import type { PRResponse, PRStatus } from "../hooks/useGitPR";

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

interface PRPanelProps {
  login: string | null;
  workspace: string | null;
  banner: {
    type: PRStatus;
    prNumber?: number;
    url?: string;
    error?: string;
    installUrl?: string;
  } | null;
  activePR: number | null;
  submitPR: (description: string) => Promise<PRResponse | undefined>;
  submitting: boolean;
  clearBanner: () => void;
  onConflictsDetected?: (conflicts: unknown[]) => void;
}

// banner/activePR/submitPR/submitting/clearBanner come from App.tsx's own
// useGitPR() call rather than a separate one here — every call to that
// hook is an independent state instance, and a second, PRPanel-owned
// instance would fetch its own redundant, never-refreshed copy of
// `changes` on mount for no reason (nothing here renders it), the same
// class of bug that broke the Changes panel not updating after a save.
export function PRPanel({
  login,
  workspace,
  banner,
  activePR,
  submitPR,
  submitting,
  clearBanner,
  onConflictsDetected = warnNoConflictUI,
}: PRPanelProps) {
  const [modalOpen, setModalOpen] = useState(false);

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
            <>
              Pull Request #{banner.prNumber} merged — this workspace's
              changes are now part of the docs.
            </>
          )}
          {banner.type === "pr_closed" && (
            <>Pull Request #{banner.prNumber} was closed without merging.</>
          )}
          {banner.type === "error" && (
            <>
              Failed to submit PR: {banner.error}
              {banner.installUrl && (
                <>
                  {" "}
                  <a href={banner.installUrl} target="_blank" rel="noreferrer">
                    Install or request the GitHub App
                  </a>
                </>
              )}
            </>
          )}
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
