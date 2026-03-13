// PRPanel.tsx

import { useState } from "react";
import { useGitPR } from "../hooks/useGitPR";

import { PRDescriptionModal } from "./PRDescriptionModal";

export function PRPanel({
  slug,
  refreshGitHubTree,
  clearEditor,
  openEditFileModal,
}) {
  const [modalOpen, setModalOpen] = useState(false);

  const { banner, activePR, submitPR, clearBanner } = useGitPR({
    refreshGitHubTree,
    clearEditor,
    openEditFileModal,
  });

  const handleOpenModal = () => setModalOpen(true);

  const handleSubmitDescription = async (description: string) => {
    setModalOpen(false);
    await submitPR(slug, description);
  };

  return (
    <div className="pr-panel">
      {banner && (
        <div className="banner">
          {banner.type === "pr_created" && (
            <>Pull Request #{banner.prNumber} created.</>
          )}
          {banner.type === "pr_updated" && (
            <>Pull Request #{banner.prNumber} updated.</>
          )}
          {banner.type === "pr_merged" && (
            <>Pull Request #{banner.prNumber} merged. Workspace reset.</>
          )}
          {banner.type === "pr_closed" && (
            <>Pull Request #{banner.prNumber} closed. Workspace reset.</>
          )}
          <button onClick={clearBanner}>×</button>
        </div>
      )}

      {activePR && <div className="active-pr">Working on PR #{activePR}</div>}

      <button className="submit-pr" onClick={handleOpenModal}>
        Set up PR
      </button>

      <PRDescriptionModal
        isOpen={modalOpen}
        onSubmit={handleSubmitDescription}
        onCancel={() => setModalOpen(false)}
      />
    </div>
  );
}
