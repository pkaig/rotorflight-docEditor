// ensureFork.ts
//
// Ensures <login>/<GITHUB_REPO> exists as a genuine fork of
// <GITHUB_OWNER>/<GITHUB_REPO>, creating it if missing, and — critically —
// polls until its git data is actually queryable before returning.
// GitHub's fork API returns 202 and replicates the fork asynchronously, so
// the repo existing is not the same as it being usable yet; callers that
// immediately read refs from a freshly-created fork can hit a 404 race.
//
// Shared between authRoutes.ts (called right after login, so fork creation
// starts as early as possible) and gitRoutes.ts (called again before a
// commit, so it's still correct even for someone who submits within
// seconds of their first login).
import { githubRequest } from "./githubClient";
import { GITHUB_OWNER, GITHUB_REPO, GITHUB_DEFAULT_BRANCH } from "./config/github";

const FORK_POLL_INTERVAL_MS = 1500;
const FORK_POLL_MAX_ATTEMPTS = 8; // ~12s of polling before giving up

export class ForkError extends Error {}

export class ForkNotReadyError extends ForkError {
  constructor() {
    super(
      "Your GitHub fork is still being created — please try again in a few seconds.",
    );
    this.name = "ForkNotReadyError";
  }
}

export class ForkConflictError extends ForkError {
  constructor() {
    super(
      `A repository named "${GITHUB_REPO}" already exists on your GitHub account but isn't a fork of ${GITHUB_OWNER}/${GITHUB_REPO}. Please rename or remove it, then try again.`,
    );
    this.name = "ForkConflictError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureFork(token: string, login: string): Promise<void> {
  let existing: any = null;
  try {
    existing = await githubRequest(token, `/repos/${login}/${GITHUB_REPO}`);
  } catch {
    existing = null;
  }

  const isRealFork =
    existing?.fork === true &&
    existing?.parent?.full_name?.toLowerCase() ===
      `${GITHUB_OWNER}/${GITHUB_REPO}`.toLowerCase();

  if (existing && !isRealFork) {
    throw new ForkConflictError();
  }

  if (!isRealFork) {
    await githubRequest(token, `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/forks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ default_branch_only: true }),
    });
  }

  for (let attempt = 0; attempt < FORK_POLL_MAX_ATTEMPTS; attempt++) {
    try {
      await githubRequest(
        token,
        `/repos/${login}/${GITHUB_REPO}/git/refs/heads/${GITHUB_DEFAULT_BRANCH}`,
      );
      return;
    } catch {
      await sleep(FORK_POLL_INTERVAL_MS);
    }
  }

  throw new ForkNotReadyError();
}
