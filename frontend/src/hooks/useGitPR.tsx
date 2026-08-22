/* frontend/src/hooks/useGitPR.tsx
 *
 * Description of responsibility:
 *   Owns PR/change-tracking state for a workspace: the list of pending
 *   local changes (scanned against the mirror baseline), the current
 *   PR status banner, and submitPR()/notifyFile*() functions that both
 *   mutate the backend and keep this state in sync afterward.
 *
 * Info:
 *   Every call to this hook is an independent state instance — React
 *   hooks don't share state across call sites — which is why App.tsx
 *   creates exactly one instance and passes its values down as props
 *   rather than letting EditorPanel/PRPanel/useDocEditor each call this
 *   hook themselves. An earlier version did exactly that, and a saved
 *   file's notifyFileSaved() call updated a `changes` value nobody was
 *   actually rendering. notifyFileCreated() returns a real {ok, error}
 *   result (not fire-and-forget) so EditorPanel's "create new page"
 *   modal can show a failure reason instead of silently doing nothing.
 */
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
  // Present when the backend determined the GitHub App itself isn't
  // installed/permitted for this account/org — a direct link to GitHub's
  // install-or-request page, since that's the only place this can
  // actually be resolved (an org owner has to approve it there).
  installUrl?: string;
}

interface UseGitPROptions {
  login: string;
  workspace: string | null;
}

/* -------------------------------------------------------
   Change tracking types
------------------------------------------------------- */
export type ChangeEntry = {
  path: string;
  type: "added" | "modified" | "deleted" | "renamed";
  from?: string;
};

export type ChangeSet = {
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
    installUrl?: string;
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
          setBanner({
            type: "error",
            error: res.error || "Something went wrong",
            installUrl: res.installUrl,
          });
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
     PR status check (detects a merge/close that happened outside
     this app — on github.com, or by a maintainer)
  ------------------------------------------------------- */
  // Deliberately separate from `banner`: banner is dismissible (the ×
  // button in PRPanel clears it), but a merged/closed indicator should
  // stay put until the user actually does something about it — someone
  // might keep adding to a workspace after its PR merges (preparing a
  // follow-up), so this app must never auto-reset anything on its own;
  // it only surfaces the state and leaves the decision to the user (see
  // the workspace-pr-badge rendered in App.tsx).
  const [prState, setPrState] = useState<"none" | "open" | "merged" | "closed">(
    "none",
  );

  // A reviewer commenting on an open PR while this app is closed/idle is
  // exactly the case a workspace-scoped in-memory flag can't catch — the
  // "seen" count needs to survive across app restarts, hence localStorage
  // rather than another useState. Keyed by workspace *and* PR number so
  // a resubmission after close/merge (a new PR number) doesn't inherit
  // an old PR's already-seen count.
  const [newCommentNotice, setNewCommentNotice] = useState<{
    prNumber: number;
    url: string;
    commentCount: number;
  } | null>(null);

  function commentsSeenKey(ws: string, prNumber: number) {
    return `rf_pr_comments_seen:${ws}:${prNumber}`;
  }

  // Records the current comment count as "seen" so the same comments
  // don't re-trigger the notice on the next check — called when the
  // user dismisses it, which in PRPanel also means they clicked through
  // to actually look at the PR.
  const dismissCommentNotice = useCallback(() => {
    if (newCommentNotice && workspace) {
      localStorage.setItem(
        commentsSeenKey(workspace, newCommentNotice.prNumber),
        String(newCommentNotice.commentCount),
      );
    }
    setNewCommentNotice(null);
  }, [newCommentNotice, workspace]);

  const checkPRStatus = useCallback(async () => {
    if (!login || !workspace) return;

    try {
      const res = await fetch(
        `/api/git/pr-status?workspace=${encodeURIComponent(workspace)}`,
        { credentials: "include" },
      );
      if (!res.ok) return;

      const data: {
        state: "none" | "open" | "merged" | "closed";
        prNumber?: number;
        url?: string;
        comments?: number;
      } = await res.json();

      setPrState(data.state);

      if (
        data.state === "open" &&
        data.prNumber != null &&
        typeof data.comments === "number"
      ) {
        const seenBefore = parseInt(
          localStorage.getItem(commentsSeenKey(workspace, data.prNumber)) || "0",
          10,
        );
        setNewCommentNotice(
          data.comments > seenBefore
            ? { prNumber: data.prNumber, url: data.url || "", commentCount: data.comments }
            : null,
        );
      } else {
        setNewCommentNotice(null);
      }

      if (data.state === "merged") {
        handleBackendResponse({ status: "pr_merged", prNumber: data.prNumber });
      } else if (data.state === "closed") {
        handleBackendResponse({ status: "pr_closed", prNumber: data.prNumber });
      } else if (data.state === "open") {
        handleBackendResponse({ status: "pr_open", prNumber: data.prNumber });
      }
      // "none" — no PR exists yet for this workspace's branch, nothing to do.
    } catch (err) {
      console.error("❌ Failed to check PR status:", err);
    }
  }, [login, workspace, handleBackendResponse]);

  // Checked on mount/workspace-switch and again on every window focus —
  // the same pattern useAuth.ts already uses for re-checking GitHub App
  // install status, and for the same reason: switching back to this
  // window is exactly when someone's likely to have just merged, closed,
  // or commented on their PR in a browser tab.
  useEffect(() => {
    if (!login || !workspace) return;
    // Reset immediately on switch rather than waiting for the check to
    // resolve, so a previous workspace's badge/notice doesn't briefly
    // show against the newly-selected one.
    setPrState("none");
    setNewCommentNotice(null);
    checkPRStatus();
    window.addEventListener("focus", checkPRStatus);
    return () => window.removeEventListener("focus", checkPRStatus);
  }, [login, workspace, checkPRStatus]);

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
    async (_slug: string, path: string, content: string) => {
      if (!login || !workspace) return { ok: false, error: "Not signed in" };

      const res = await fetch(
        `/api/docs/create?login=${encodeURIComponent(
          login,
        )}&workspace=${encodeURIComponent(workspace)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, content }),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error || "Failed to create file" };
      }

      await loadChangesFromMirror();
      return { ok: true };
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
    checkPRStatus,
    prState,
    newCommentNotice,
    dismissCommentNotice,
    clearBanner: () => setBanner(null),
  };
}
