import { useState, useCallback, useEffect } from "react";

export type PRStatus =
  | "no_pr"
  | "pr_open"
  | "pr_created"
  | "pr_updated"
  | "pr_merged"
  | "pr_closed"
  | "error";

export interface PRResponse {
  status: PRStatus;
  prNumber?: number;
  url?: string;
  error?: string;
}

interface UseGitPROptions {
  login: string;
  workspace: string | null;
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

export function useGitPR({ login, workspace }: UseGitPROptions) {
  const [banner, setBanner] = useState<null | {
    type: PRStatus;
    prNumber?: number;
    url?: string;
    error?: string;
  }>(null);

  const [activePR, setActivePR] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    if (!login || !workspace) return;

    try {
      const response = await fetch(
        `/api/docs/scan-local-changes?login=${encodeURIComponent(
          login,
        )}&workspace=${encodeURIComponent(workspace)}`,
        { credentials: "include" },
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
  }, [login, workspace]);

  // Load changes on mount / login / workspace change
  useEffect(() => {
    if (login && workspace) {
      loadChangesFromMirror();
    }
  }, [login, workspace, loadChangesFromMirror]);

  /* -------------------------------------------------------
     Backend response handler
  ------------------------------------------------------- */
  const handleBackendResponse = useCallback(
    (res: PRResponse) => {
      switch (res.status) {
        case "pr_created":
          setActivePR(res.prNumber ?? null);
          setBanner({ type: "pr_created", prNumber: res.prNumber, url: res.url });
          break;

        case "pr_updated":
          setActivePR(res.prNumber ?? null);
          setBanner({ type: "pr_updated", prNumber: res.prNumber, url: res.url });
          break;

        case "error":
          setBanner({ type: "error", error: res.error || "Something went wrong" });
          break;

        case "pr_merged":
          setActivePR(null);
          setBanner({ type: "pr_merged", prNumber: res.prNumber });
          loadChangesFromMirror();
          break;

        case "pr_closed":
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
    [loadChangesFromMirror],
  );

  /* -------------------------------------------------------
     Submit PR
  ------------------------------------------------------- */
  const submitPR = useCallback(
    async (description: string) => {
      if (!login || !workspace) return;

      setSubmitting(true);
      setBanner(null);

      try {
        const res = await fetch(
          `/api/docs/submit-pr?login=${encodeURIComponent(
            login,
          )}&workspace=${encodeURIComponent(workspace)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description }),
          },
        );

        const json: PRResponse = await res.json();
        handleBackendResponse(json);
        return json;
      } catch (err) {
        console.error("submitPR failed:", err);
        setBanner({ type: "error", error: "Failed to reach the server" });
      } finally {
        setSubmitting(false);
      }
    },
    [login, workspace, handleBackendResponse],
  );

  /* -------------------------------------------------------
     File operation notifications (mirror-based)
     These trigger a rescan.
  ------------------------------------------------------- */
  const notifyFileSaved = useCallback(async () => {
    await loadChangesFromMirror();
  }, [loadChangesFromMirror]);

  const notifyFileRenamed = useCallback(
    async (_slug: string, oldPath: string, newPath: string) => {
      if (!login || !workspace) return;

      await fetch(
        `/api/docs/rename?login=${encodeURIComponent(
          login,
        )}&workspace=${encodeURIComponent(workspace)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldPath, newPath }),
        },
      );

      await loadChangesFromMirror();
    },
    [login, workspace, loadChangesFromMirror],
  );

  const notifyFileDeleted = useCallback(
    async (_slug: string, path: string) => {
      if (!login || !workspace) return;

      await fetch(
        `/api/docs/delete?login=${encodeURIComponent(
          login,
        )}&workspace=${encodeURIComponent(workspace)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        },
      );

      await loadChangesFromMirror();
    },
    [login, workspace, loadChangesFromMirror],
  );

  const notifyFileCreated = useCallback(
    async (_slug: string, path: string) => {
      if (!login || !workspace) return;

      await fetch(
        `/api/docs/create?login=${encodeURIComponent(
          login,
        )}&workspace=${encodeURIComponent(workspace)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        },
      );

      await loadChangesFromMirror();
    },
    [login, workspace, loadChangesFromMirror],
  );

  /* -------------------------------------------------------
     Return API
  ------------------------------------------------------- */
  return {
    banner,
    activePR,
    submitPR,
    submitting,
    changes,
    loadChangesFromMirror,
    notifyFileSaved,
    notifyFileRenamed,
    notifyFileDeleted,
    notifyFileCreated,
    clearBanner: () => setBanner(null),
  };
}
