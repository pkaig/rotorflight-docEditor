/* backend/routes/gitRoutes.ts
 *
 * Description of responsibility:
 *   Talks to the GitHub Git Data API to turn a workspace's local file
 *   changes into a real commit on the user's fork, and to open or
 *   update the pull request from that fork branch back to upstream.
 *   Also brings a fork branch's docs content forward from upstream
 *   before committing on top of it, so a stale fork branch doesn't
 *   silently diverge.
 *
 * Info:
 *   commitChanges() and submitPullRequest() are exported as plain
 *   functions, not just used by their own /commit and /pr routes, so
 *   docsRoutes.ts's /submit-pr can call them directly in-process
 *   instead of the HTTP self-calls it used to make (which stopped
 *   carrying valid auth once these routes started requiring a session
 *   cookie). syncBranchWithUpstream() does a real merge of upstream's
 *   default branch into the workspace branch via GitHub's Merges API
 *   (POST /repos/{owner}/{repo}/merges) — an earlier version only spliced
 *   the docs/versioned_docs/project-words.txt tree entries onto the
 *   branch's existing history instead, avoiding a real merge because that
 *   needs the App's separate `workflows` permission whenever upstream has
 *   touched .github/workflows/*. That kept the branch's own commit graph
 *   permanently behind upstream (GitHub always showed it as "N commits
 *   behind"), confusing real contributors even though the PR's diff was
 *   still correct. Now that the App has been granted `workflows` too,
 *   doing the real merge is both simpler than the tree-splicing and
 *   actually keeps the branch's history in sync, not just its content.
 */
import express from "express";
import { getTokenForUser } from "./authRoutes";
import {
  GitHubApiError,
  GitHubAppNotInstalledError,
  GitHubRateLimitError,
  rateLimitRetryAfterSeconds,
  MAX_AUTO_RETRY_WAIT_SECONDS,
  sleep,
} from "../githubClient";
import { ensureFork, ForkError, UpstreamMergeConflictError } from "../ensureFork";
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_DEFAULT_BRANCH,
  GITHUB_APP_INSTALL_URL,
} from "../config/github";
import path from "path";
import fs from "fs-extra";
import { isSafePathSegment, isSafeRelativePath } from "../safePath";

const router = express.Router();

// Anything committed through commitChanges() with one of these extensions
// goes through the base64 git-blob path instead of inline text content —
// see the comment at its one call site for why that distinction matters.
const BINARY_FILE_RE = /\.(png|jpe?g|gif|svg|webp|mp4)$/i;

/* ============================================================
   Helpers
   ============================================================ */

// Real merge, not a tree splice: POSTs to GitHub's Merges API with the
// workspace branch as base and upstream's current default-branch commit
// as head, so the branch's own history genuinely includes upstream's
// commits afterward. head is a bare commit SHA from a different repo
// (rotorflight/rotorflight-docs), which works because a real fork shares
// object storage with its upstream — any upstream commit is readable
// within the fork by SHA even though it was never merged into the fork's
// own refs (the same fact ensureBranch's own comment below relies on).
//
// Uses a bare fetch instead of the shared githubRequest() helper because
// this is the one call site here that has to distinguish three different
// non-JSON-body outcomes on top of the usual error path: 201 (created a
// real merge commit), 204 (base already contains head — nothing to
// merge, not an error), and 409 (a genuine content conflict, not a
// GitHub-access problem).
async function syncBranchWithUpstream(
  token: string,
  login: string,
  branch: string,
) {
  const upstreamRef = await githubRequest(
    token,
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${GITHUB_DEFAULT_BRANCH}`,
  );
  const upstreamSha = upstreamRef.object.sha;

  console.log(`🔄 Merging upstream (${upstreamSha}) into fork branch "${branch}"…`);

  const res = await fetch(
    `https://api.github.com/repos/${login}/${GITHUB_REPO}/merges`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        base: branch,
        head: upstreamSha,
        commit_message: `Merge upstream/${GITHUB_DEFAULT_BRANCH} into ${branch}`,
      }),
    },
  );

  if (res.status === 204) {
    console.log("✅ Branch already up to date with upstream");
    return;
  }

  if (res.status === 201) {
    const merge = await res.json();
    console.log("✅ Branch synced via real merge, new head:", merge.sha);
    return;
  }

  if (res.status === 409) {
    throw new UpstreamMergeConflictError(branch);
  }

  const retryAfterSeconds = rateLimitRetryAfterSeconds(res);
  if (retryAfterSeconds !== null) {
    throw new GitHubRateLimitError(res.status, retryAfterSeconds);
  }

  const text = await res.text();
  const acceptedPermissions = res.headers.get("x-accepted-github-permissions");
  console.error("❌ Merge-upstream error:", res.status, text);
  console.error("❌ X-Accepted-GitHub-Permissions:", acceptedPermissions || "(not sent)");
  throw new GitHubApiError(
    res.status,
    `GitHub API error: ${res.status} ${text}` +
      (acceptedPermissions ? ` (needs permission: ${acceptedPermissions})` : ""),
  );
}

// Ensure a workspace branch exists in the user's fork, then bring its docs
// content up to date with upstream before the caller commits the user's
// own local changes on top.
async function ensureBranch(token: string, login: string, branch: string) {
  console.log(
    `🔍 ensureBranch(): checking branch "${branch}" in fork ${login}/${GITHUB_REPO}`,
  );

  let branchExists = true;

  try {
    const ref = await githubRequest(
      token,
      `/repos/${login}/${GITHUB_REPO}/git/refs/heads/${branch}`,
    );
    console.log("✅ Branch exists:", ref.ref);
  } catch {
    branchExists = false;
    console.log(`⚠️ Branch "${branch}" missing — creating from upstream main`);
  }

  if (!branchExists) {
    // Branch from the FORK's own default branch tip, not upstream's — a
    // fork's default branch is usually behind upstream (forks don't
    // auto-update), and creating a ref pointing at a commit that was never
    // actually merged into the fork's own history fails with a 404 from
    // GitHub's Git Data API, even though that commit is individually
    // readable by SHA across the fork network. syncBranchWithUpstream
    // (called below, unconditionally) merges it forward to upstream's
    // actual current state right after.
    const base = await githubRequest(
      token,
      `/repos/${login}/${GITHUB_REPO}/git/refs/heads/${GITHUB_DEFAULT_BRANCH}`,
    );

    console.log("📌 Fork base SHA:", base.object.sha);
    console.log("🔧 Creating branch in fork:", `refs/heads/${branch}`);

    await githubRequest(
      token,
      `/repos/${login}/${GITHUB_REPO}/git/refs`,
      "POST",
      {
        ref: `refs/heads/${branch}`,
        sha: base.object.sha,
      },
    );
  }

  // Run on every call, not just branch creation — an already-existing
  // workspace branch (e.g. submitting a follow-up update to an open PR)
  // can just as easily have drifted from upstream since it was created.
  await syncBranchWithUpstream(token, login, branch);

  return await githubRequest(
    token,
    `/repos/${login}/${GITHUB_REPO}/git/refs/heads/${branch}`,
  );
}

/* ============================================================
   1. CREATE COMMIT (to user fork)
   ============================================================ */

// Plain function, not just the route handler below, so docsRoutes.ts's
// /submit-pr can call this directly in-process. It used to hit this route
// over HTTP (localhost self-call) instead — which stopped working once
// /commit started requiring a session, since a server-to-server fetch()
// doesn't carry the original browser's session cookie.
export async function commitChanges(
  login: string,
  workspace: string,
  changes: any,
) {
  if (!isSafePathSegment(workspace)) {
    throw new Error("Invalid workspace");
  }
  const allPaths = [
    ...changes.added,
    ...changes.modified,
    ...changes.deleted,
  ].map((item: any) => item.path);
  if (!allPaths.every((p) => isSafeRelativePath(p))) {
    throw new Error("Invalid file path in changes");
  }

  const token = getTokenForUser(login);
  const branch = `${workspace}`;

  console.log("🔧 Ensuring fork exists…");
  await ensureFork(token, login);

  console.log("🔧 Ensuring branch exists…");
  const ref = await ensureBranch(token, login, branch);

  console.log("📌 Branch head SHA:", ref.object.sha);

  console.log("🔍 Fetching head commit object…");
  const headCommit = await githubRequest(
    token,
    `/repos/${login}/${GITHUB_REPO}/git/commits/${ref.object.sha}`,
  );

  const baseTreeSha = headCommit.tree.sha;
  console.log("📌 Base tree SHA:", baseTreeSha);

  const workspaceRoot = path.join(
    process.cwd(),
    "workspaces",
    login,
    workspace,
  );

  console.log("📁 Workspace root:", workspaceRoot);

  const treeItems: any[] = [];

  console.log(
    "📝 Added/Modified files:",
    changes.added.length + changes.modified.length,
  );
  console.log("🗑 Deleted files:", changes.deleted.length);

  for (const item of [...changes.added, ...changes.modified]) {
    const fullPath = path.join(workspaceRoot, item.path);
    console.log("📄 Adding file:", item.path);

    if (BINARY_FILE_RE.test(item.path)) {
      // Git trees' inline `content` field is UTF-8 text only — reading a
      // PNG/etc.'s raw bytes with fs.readFile(path, "utf8") mangles any
      // byte sequence that isn't valid UTF-8 (silently, no error), and
      // GitHub's tree API then commits that already-corrupted text as the
      // blob. The file looks fine locally (nothing here ever reads it
      // back through this path) and the commit/PR/merge all succeed
      // without error, but the committed image is broken from that point
      // on — reproducible every time by re-cloning and opening it fresh.
      // A binary file has to go through its own blob first, base64-
      // encoded, referenced by sha instead of inline content.
      const buffer = await fs.readFile(fullPath);
      const blob = await githubRequest(
        token,
        `/repos/${login}/${GITHUB_REPO}/git/blobs`,
        "POST",
        { content: buffer.toString("base64"), encoding: "base64" },
      );

      treeItems.push({
        path: item.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
      continue;
    }

    const content = await fs.readFile(fullPath, "utf8");

    treeItems.push({
      path: item.path,
      mode: "100644",
      type: "blob",
      content,
    });
  }

  for (const item of changes.deleted) {
    console.log("🗑 Deleting file:", item.path);

    treeItems.push({
      path: item.path,
      mode: "100644",
      type: "blob",
      sha: null,
    });
  }

  console.log("🌲 Creating new tree…");

  const tree = await githubRequest(
    token,
    `/repos/${login}/${GITHUB_REPO}/git/trees`,
    "POST",
    {
      base_tree: baseTreeSha,
      tree: treeItems,
    },
  );

  const commit = await githubRequest(
    token,
    `/repos/${login}/${GITHUB_REPO}/git/commits`,
    "POST",
    {
      message: `Workspace update: ${workspace}`,
      tree: tree.sha,
      parents: [ref.object.sha],
    },
  );

  await githubRequest(
    token,
    `/repos/${login}/${GITHUB_REPO}/git/refs/heads/${branch}`,
    "PATCH",
    { sha: commit.sha },
  );

  console.log("✅ Commit complete");
}

router.post("/commit", async (req, res) => {
  const login = req.session?.login;
  const workspace = req.query.workspace as string;
  const { changes } = req.body;

  if (!login) {
    return res.status(401).json({ error: "Not signed in" });
  }
  if (!isSafePathSegment(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }

  console.log("============================================================");
  console.log("📥 /commit request");
  console.log("👤 User:", login);
  console.log("🗂 Workspace:", workspace);
  console.log("============================================================");

  try {
    await commitChanges(login, workspace, changes);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Commit failed:", err);
    if (err instanceof ForkError) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: "Commit failed" });
  }
});

/* ============================================================
   2. CREATE OR UPDATE PR (fork → upstream)
   ============================================================ */

// Same reasoning as commitChanges above — a plain function so
// docsRoutes.ts's /submit-pr can call it in-process instead of over HTTP.
export async function submitPullRequest(
  login: string,
  workspace: string,
  description: string,
) {
  const token = getTokenForUser(login);
  const branch = `${workspace}`;

  console.log("🔍 Checking for existing PR…");

  let prs, pr;
  let created: boolean;

  try {
    prs = await githubRequest(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls?head=${login}:${branch}&state=open`,
    );

    if (prs.length > 0) {
      console.log("✏️ Updating existing PR:", prs[0].number);

      pr = await githubRequest(
        token,
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls/${prs[0].number}`,
        "PATCH",
        { body: description },
      );
      created = false;
    } else {
      console.log("🆕 Creating new PR…");

      pr = await githubRequest(
        token,
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls`,
        "POST",
        {
          title: `Docs updates from workspace "${workspace}"`,
          head: `${login}:${branch}`,
          base: GITHUB_DEFAULT_BRANCH,
          body: description,
        },
      );
      created = true;
    }
  } catch (err) {
    // Same reasoning as ensureFork's fork-creation call: GITHUB_OWNER/
    // GITHUB_REPO always exists, so a 403/404 here means the App has no
    // usable installation/permissions for pull requests on this repo, not
    // a genuinely missing resource.
    if (err instanceof GitHubApiError && (err.status === 403 || err.status === 404)) {
      throw new GitHubAppNotInstalledError(GITHUB_APP_INSTALL_URL);
    }
    throw err;
  }

  console.log("✅ PR ready:", pr.html_url);

  // Status uses the pr_created/pr_updated vocabulary the frontend's
  // PRResponse type actually switches on — this used to send
  // { number, url, state } instead, which the frontend's handler never
  // matched, so a successful PR submission produced no visible banner.
  return {
    status: created ? "pr_created" : "pr_updated",
    prNumber: pr.number,
    url: pr.html_url,
  };
}

router.post("/pr", async (req, res) => {
  const login = req.session?.login;
  const workspace = req.query.workspace as string;
  const { description } = req.body;

  if (!login) {
    return res.status(401).json({ error: "Not signed in" });
  }
  if (!isSafePathSegment(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }

  console.log("============================================================");
  console.log("📥 /pr request");
  console.log("👤 User:", login);
  console.log("🗂 Workspace:", workspace);
  console.log("============================================================");

  try {
    const result = await submitPullRequest(login, workspace, description);
    res.json(result);
  } catch (err) {
    console.error("❌ PR failed:", err);
    res.status(500).json({ status: "error", error: "Failed to create/update PR" });
  }
});

/* ============================================================
   3. GITHUB REQUEST
   ============================================================ */
export async function githubRequest(
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
  _isRetry = false,
) {
  console.log("Github Request");
  const jsonBody = body ? JSON.stringify(body) : undefined;
  console.log("jsonBody", jsonBody);
  const headers: any = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Thunder Client (https://www.thunderclient.com)",
  };
  console.log("Headers", headers);

  if (jsonBody) {
    headers["Content-Type"] = "application/json";
  }

  // ⭐ LOG THE FULL REQUEST EXACTLY AS IT WILL BE SENT
  console.log("========================================");
  console.log("📤 OUTGOING REQUEST");
  console.log("URL:", `https://api.github.com${path}`);
  console.log("Method:", method);
  console.log("Headers:", headers);
  console.log("Body:", jsonBody);
  console.log("========================================");

  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: jsonBody,
  });

  if (!res.ok) {
    // Checked first, before anything else — this function is what
    // commitChanges() calls once per changed file (a blob-creation call
    // per image, plus the tree/commit/ref calls), so a workspace with a
    // dozen-plus images is exactly the realistic case for tripping
    // GitHub's secondary/abuse rate limit here.
    const retryAfterSeconds = rateLimitRetryAfterSeconds(res);
    if (retryAfterSeconds !== null) {
      if (!_isRetry && retryAfterSeconds <= MAX_AUTO_RETRY_WAIT_SECONDS) {
        console.warn(
          `GitHub API rate limited on ${path} — waiting ${retryAfterSeconds}s and retrying once`,
        );
        await sleep(retryAfterSeconds * 1000);
        return githubRequest(token, path, method, body, true);
      }
      throw new GitHubRateLimitError(res.status, retryAfterSeconds);
    }

    const text = await res.text();
    // GitHub returns this specific header on a 403 naming exactly which
    // permission was missing for the request — the only reliable way to
    // tell "wrong permission configured" apart from "app not installed
    // on this repo" apart from "user doesn't have access" without
    // guessing, per GitHub's own REST API docs.
    const acceptedPermissions = res.headers.get("x-accepted-github-permissions");
    console.error("❌ GitHub API error:", res.status, text);
    console.error("❌ X-Accepted-GitHub-Permissions:", acceptedPermissions || "(not sent)");
    throw new GitHubApiError(
      res.status,
      `GitHub API error: ${res.status} ${text}` +
        (acceptedPermissions ? ` (needs permission: ${acceptedPermissions})` : ""),
    );
  }

  return await res.json();
}

export default router;
