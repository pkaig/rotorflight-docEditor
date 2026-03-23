import { useState, useCallback, useEffect } from "react";

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
     Mirror-based change tracking
  ------------------------------------------------------- */
  const [changes, setChanges] = useState<ChangeSet>({
    added: [],
    modified: [],
    deleted: [],
    renamed: [],
  });

  const loadChangesFromMirror = useCallback(async () => {
    if (!login) return;

    try {
      const response = await fetch(
        `/api/docs/scan-local-changes?login=${login}`,
        {
          credentials: "include",
        },
      );

      const data = await response.json();

      setChanges({
        added: data.added ?? [],
        modified: data.modified ?? [],
        deleted: data.deleted ?? [],
        renamed: data.renamed ?? [],
      });
    } catch (err) {
      console.error("❌ Failed to load mirror changes:", err);

      setChanges({
        added: [],
        modified: [],
        deleted: [],
        renamed: [],
      });
    }
  }, [login]);

  // Load changes on mount / login change
  useEffect(() => {
    if (login) {
      loadChangesFromMirror();
    }
  }, [login]);

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

          // After merge, local workspace is reset externally.
          loadChangesFromMirror();
          break;

        case "pr_closed":
          clearEditor();
          refreshGitHubTree();
          setActivePR(null);
          setBanner({ type: "pr_closed", prNumber: res.prNumber });

          loadChangesFromMirror();
          break;

        case "pr_open":
          setActivePR(res.prNumber ?? null);
          break;

        default:
          break;
      }
    },
    [clearEditor, refreshGitHubTree, loadChangesFromMirror],
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
     File operation notifications (mirror-based)
     These no longer mutate state — they trigger a rescan.
  ------------------------------------------------------- */
  const notifyFileSaved = useCallback(
    async (_slug: string, _path: string) => {
      await loadChangesFromMirror();
    },
    [loadChangesFromMirror],
  );

  const notifyFileRenamed = useCallback(
    async (slug: string, oldPath: string, newPath: string) => {
      await fetch("/api/docs/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, oldPath, newPath }),
      });

      await loadChangesFromMirror();
    },
    [loadChangesFromMirror],
  );

  const notifyFileDeleted = useCallback(
    async (slug: string, path: string) => {
      await fetch("/api/docs/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, path }),
      });

      await loadChangesFromMirror();
    },
    [loadChangesFromMirror],
  );

  const notifyFileCreated = useCallback(
    async (slug: string, path: string) => {
      await fetch("/api/docs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, path }),
      });

      await loadChangesFromMirror();
    },
    [loadChangesFromMirror],
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
     Return API
  ------------------------------------------------------- */
  return {
    banner,
    activePR,
    submitPR,
    changes,
    loadChangesFromMirror,
    notifyFileSaved,
    notifyFileRenamed,
    notifyFileDeleted,
    notifyFileCreated,
    editFile,
    clearBanner: () => setBanner(null),
  };
}
