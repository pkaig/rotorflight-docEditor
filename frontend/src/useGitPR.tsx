// useGitPR.tsx

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
}

export function useGitPR({
  refreshGitHubTree,
  clearEditor,
  openEditFileModal,
}: UseGitPROptions) {
  const [banner, setBanner] = useState<null | {
    type: PRStatus;
    prNumber?: number;
  }>(null);
  const [activePR, setActivePR] = useState<number | null>(null);

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
          break;

        case "pr_closed":
          clearEditor();
          refreshGitHubTree();
          setActivePR(null);
          setBanner({ type: "pr_closed", prNumber: res.prNumber });
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

  const notifyFileSaved = useCallback(
    async (slug: string, path: string) => {
      const res = await fetch("/api/docs/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, path }),
      });

      const json: PRResponse = await res.json();
      handleBackendResponse(json);
    },
    [handleBackendResponse],
  );

  const notifyFileRenamed = useCallback(
    async (slug: string, oldPath: string, newPath: string) => {
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

  const editFile = useCallback(
    (path: string) => {
      openEditFileModal(path);
    },
    [openEditFileModal],
  );

  return {
    banner,
    activePR,
    submitPR,
    notifyFileSaved,
    notifyFileRenamed,
    notifyFileDeleted,
    notifyFileCreated,
    editFile,
    clearBanner: () => setBanner(null),
  };
}
