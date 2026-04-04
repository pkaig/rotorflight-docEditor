// handleGitPR.ts

import {
  markAdded,
  markModified,
  markRenamed,
  markDeleted,
  getChanges,
  clearChanges,
} from "./changeTracker";

import {
  loadSession,
  saveSession,
  deleteSession,
  sessionExists,
} from "./prSession";

import {
  createBranch,
  commitChanges,
  pushBranch,
  resetWorkspaceForSlug,
} from "./gitWorkspace";

import { createPR, updatePR, getPRStatus } from "./prLifecycle";

export async function onFileSaved(slug: string, path: string) {
  markModified(slug, path);
  return await checkPRState(slug);
}

export async function onFileCreated(slug: string, path: string) {
  markAdded(slug, path);
  return await checkPRState(slug);
}

export async function onFileRenamed(
  slug: string,
  oldPath: string,
  newPath: string,
) {
  markRenamed(slug, oldPath, newPath);
  return await checkPRState(slug);
}

export async function onFileDeleted(slug: string, path: string) {
  markDeleted(slug, path);
  return await checkPRState(slug);
}

async function checkPRState(slug: string) {
  if (!sessionExists(slug)) return { status: "no_pr" };

  const session = loadSession(slug)!;
  const pr = await getPRStatus(session.prNumber);

  if (pr.merged) {
    resetWorkspaceForSlug(slug, session.changes);
    deleteSession(slug);
    clearChanges(slug);
    return { status: "pr_merged", prNumber: session.prNumber };
  }

  if (pr.state === "closed") {
    resetWorkspaceForSlug(slug, session.changes);
    deleteSession(slug);
    clearChanges(slug);
    return { status: "pr_closed", prNumber: session.prNumber };
  }

  return { status: "pr_open", prNumber: session.prNumber };
}

export async function submitPR(description: string) {
  const res = await fetch("/api/docs/submit-pr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });

  if (!res.ok) {
    throw new Error("Failed to submit PR");
  }

  return await res.json();
}
