import { useState, useCallback } from "react";

export type PRStatus =
  | "no_pr"
  | "pr_open"
  | "pr_created"
  | "pr_updated"
  | "pr_merged"
  | "pr_closed";

export interface PRResponse {
  status: PRStatus;
  prNumber?: number;
  url?: string;
}

interface UseGitPROptions {
  refreshGitHubTree: () => void;
  clearEditor: () => void;
  openEditFileModal: (path: string) => void;
  login: string;
}

/* -------------------------------------------------------
   Change tracking types
------------------------------------------------------- */
type ChangeEntry = {
  path: string;
  type: "added" | "modified" | "deleted" | "renamed";
  from?: string;
};

type ChangeSet = {
  added: ChangeEntry[];
  modified: ChangeEntry[];
  deleted: ChangeEntry[];
  renamed: ChangeEntry[];
};

export function useGitPR({
  refreshGitHubTree,
  clearEditor,
  openEditFileModal,
  login,
}: UseGitPROptions) {
  const [banner, setBanner] = useState<null | {
    type: PRStatus;
    prNumber?: number;
  }>(null);

  const [activePR, setActivePR] = useState<number | null>(null);

  /* -------------------------------------------------------
     Change tracking state
  ------------------------------------------------------- */
  const [changes, setChanges] = useState<ChangeSet>({
    added: [],
    modified: [],
    deleted: [],
    renamed: [],
  });

  function mergeUnique(list: ChangeEntry[], entry: ChangeEntry) {
    return list.some((i) => i.path === entry.path) ? list : [...list, entry];
  }

  /* -------------------------------------------------------
     Backend response handler
  ------------------------------------------------------- */
  const handleBackendResponse = useCallback(
    (res: PRResponse) => {
      switch (res.status) {
        case "pr_created":
          setActivePR(res.prNumber ?? null);
          setBanner({ type: "pr_created", prNumber: res.prNumber });
          break;

        case "pr_updated":
          setBanner({ type: "pr_updated", prNumber: res.prNumber });
          break;

        case "pr_merged":
          clearEditor();
          refreshGitHubTree();
          setActivePR(null);
          setBanner({ type: "pr_merged", prNumber: res.prNumber });

          // Reset changes after merge
          setChanges({
            added: [],
            modified: [],
            deleted: [],
            renamed: [],
          });
          break;

        case "pr_closed":
          clearEditor();
          refreshGitHubTree();
          setActivePR(null);
          setBanner({ type: "pr_closed", prNumber: res.prNumber });

          // Reset changes after close
          setChanges({
            added: [],
            modified: [],
            deleted: [],
            renamed: [],
          });
          break;

        case "pr_open":
          setActivePR(res.prNumber ?? null);
          break;

        default:
          break;
      }
    },
    [clearEditor, refreshGitHubTree],
  );

  /* -------------------------------------------------------
     Submit PR
  ------------------------------------------------------- */
  const submitPR = useCallback(
    async (slug: string, description: string) => {
      const res = await fetch("/api/docs/submit-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, description }),
      });

      const json: PRResponse = await res.json();
      handleBackendResponse(json);
      return json;
    },
    [handleBackendResponse],
  );

  /* -------------------------------------------------------
     Change tracking + backend notify functions
  ------------------------------------------------------- */
  const notifyFileSaved = useCallback(
    async (slug: string, path: string) => {
      console.log("🔧 [notifyFileSaved] File saved:", slug, path);

      // Only track local-workspace changes
      if (slug !== "local-workspace") {
        return;
      }

      setChanges((prev) => ({
        ...prev,
        modified: mergeUnique(prev.modified, { path, type: "modified" }),
      }));

      // PR tracking does NOT save files.
      // Autosave handles saving.
    },
    [handleBackendResponse],
  );

  const notifyFileRenamed = useCallback(
    async (slug: string, oldPath: string, newPath: string) => {
      // Track rename
      setChanges((prev) => ({
        ...prev,
        renamed: mergeUnique(prev.renamed, {
          path: newPath,
          from: oldPath,
          type: "renamed",
        }),
      }));

      const res = await fetch("/api/docs/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, oldPath, newPath }),
      });

      const json: PRResponse = await res.json();
      handleBackendResponse(json);
    },
    [handleBackendResponse],
  );

  const notifyFileDeleted = useCallback(
    async (slug: string, path: string) => {
      // Track deletion
      setChanges((prev) => ({
        ...prev,
        deleted: mergeUnique(prev.deleted, { path, type: "deleted" }),
      }));

      const res = await fetch("/api/docs/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, path }),
      });

      const json: PRResponse = await res.json();
      handleBackendResponse(json);
    },
    [handleBackendResponse],
  );

  const notifyFileCreated = useCallback(
    async (slug: string, path: string) => {
      // Track creation
      setChanges((prev) => ({
        ...prev,
        added: mergeUnique(prev.added, { path, type: "added" }),
      }));

      const res = await fetch("/api/docs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, path }),
      });

      const json: PRResponse = await res.json();
      handleBackendResponse(json);
    },
    [handleBackendResponse],
  );

  /* -------------------------------------------------------
     Edit file
  ------------------------------------------------------- */
  const editFile = useCallback(
    (path: string) => {
      openEditFileModal(path);
    },
    [openEditFileModal],
  );

  /* -------------------------------------------------------
     Clear all tracked changes (e.g. after PR merge or close)
  ------------------------------------------------------- */

  function clearAllChanges() {
    setChanges({
      added: [],
      modified: [],
      deleted: [],
      renamed: [],
    });
  }

  /* -------------------------------------------------------
     Return API
  ------------------------------------------------------- */
  return {
    banner,
    activePR,
    submitPR,
    changes,
    clearAllChanges,
    notifyFileSaved,
    notifyFileRenamed,
    notifyFileDeleted,
    notifyFileCreated,
    editFile,
    clearBanner: () => setBanner(null),
  };
}
