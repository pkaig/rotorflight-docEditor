// ./routes/gitRoutes.ts
import express from "express";
import { getTokenForUser, assertRepoScope } from "./authRoutes";
//import { githubRequest } from "../githubClient";
import { ensureFork, ForkError } from "../ensureFork";
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_DEFAULT_BRANCH,
} from "../config/github";
import path from "path";
import fs from "fs-extra";

const router = express.Router();

/* ============================================================
   Helpers
   ============================================================ */

// Resolves a branch name or commit SHA to its commit + top-level tree entries.
async function getTreeEntries(
  token: string,
  owner: string,
  repo: string,
  branchOrSha: string,
) {
  let commitSha = branchOrSha;

  if (!/^[0-9a-f]{40}$/i.test(branchOrSha)) {
    const ref = await githubRequest(
      token,
      `/repos/${owner}/${repo}/git/refs/heads/${branchOrSha}`,
    );
    commitSha = ref.object.sha;
  }

  const commit = await githubRequest(
    token,
    `/repos/${owner}/${repo}/git/commits/${commitSha}`,
  );
  const tree = await githubRequest(
    token,
    `/repos/${owner}/${repo}/git/trees/${commit.tree.sha}`,
  );

  return {
    commitSha,
    treeSha: commit.tree.sha as string,
    entries: tree.tree as Array<{
      path: string;
      mode: string;
      type: string;
      sha: string;
    }>,
  };
}

// Everything this app ever reads or writes — nothing else in the repo
// (.github/workflows, package.json, etc.) is touched by this sync.
const SYNCED_PATHS = ["docs", "versioned_docs", "project-words.txt"];

// Brings a fork branch's docs content up to date with upstream by building
// a new tree that's identical to the branch's current tree except these
// specific top-level paths are swapped for upstream's current versions —
// everything else (crucially .github/workflows/*) is inherited byte-for-
// byte unchanged from the branch's own tree via `base_tree`.
//
// A full "sync this fork with upstream" (GitHub's merge-upstream API, what
// the "Sync fork" button does) was tried first and doesn't work here:
// GitHub refuses it for any OAuth app lacking the `workflow` scope whenever
// the sync would touch `.github/workflows/*`, which upstream has, and
// requesting that broader scope is a real permission decision that
// shouldn't happen silently as a side effect of this fix. Since no
// workflow file content actually changes with this targeted approach,
// GitHub allows it without that scope.
async function syncBranchWithUpstreamDocs(
  token: string,
  login: string,
  branch: string,
) {
  console.log(
    `🔄 Syncing [${SYNCED_PATHS.join(", ")}] from upstream into fork branch "${branch}"…`,
  );

  const upstream = await getTreeEntries(
    token,
    GITHUB_OWNER,
    GITHUB_REPO,
    GITHUB_DEFAULT_BRANCH,
  );
  const fork = await getTreeEntries(token, login, GITHUB_REPO, branch);

  const overrides = upstream.entries.filter((e) =>
    SYNCED_PATHS.includes(e.path),
  );

  if (overrides.length === 0) {
    console.warn(
      "⚠️ None of the synced paths were found upstream — skipping sync",
    );
    return fork.commitSha;
  }

  const newTree = await githubRequest(
    token,
    `/repos/${login}/${GITHUB_REPO}/git/trees`,
    "POST",
    {
      base_tree: fork.treeSha,
      tree: overrides.map((e) => ({
        path: e.path,
        mode: e.mode,
        type: e.type,
        sha: e.sha,
      })),
    },
  );

  if (newTree.sha === fork.treeSha) {
    console.log("✅ Branch already matches upstream for synced paths");
    return fork.commitSha;
  }

  const commit = await githubRequest(
    token,
    `/repos/${login}/${GITHUB_REPO}/git/commits`,
    "POST",
    {
      message: `Sync ${SYNCED_PATHS.join(", ")} with upstream`,
      tree: newTree.sha,
      parents: [fork.commitSha],
    },
  );

  // Always a valid fast-forward — the new commit's parent is exactly the
  // branch's current head.
  await githubRequest(
    token,
    `/repos/${login}/${GITHUB_REPO}/git/refs/heads/${branch}`,
    "PATCH",
    { sha: commit.sha },
  );

  console.log("✅ Branch synced, new head:", commit.sha);
  return commit.sha;
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
    // readable by SHA across the fork network. syncBranchWithUpstreamDocs
    // (called below, unconditionally) brings its doc content forward from
    // this potentially-stale base right after.
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
  await syncBranchWithUpstreamDocs(token, login, branch);

  return await githubRequest(
    token,
    `/repos/${login}/${GITHUB_REPO}/git/refs/heads/${branch}`,
  );
}

/* ============================================================
   1. CREATE COMMIT (to user fork)
   ============================================================ */

router.post("/commit", async (req, res) => {
  const login = req.query.login as string;
  const workspace = req.query.workspace as string;
  const { changes } = req.body;

  console.log("============================================================");
  console.log("📥 /commit request");
  console.log("👤 User:", login);
  console.log("🗂 Workspace:", workspace);
  console.log("🔀 Branch name:", workspace);
  console.log("============================================================");

  try {
    const token = getTokenForUser(login);
    await assertRepoScope(token);
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

    //    console.log("📌 New tree SHA:", tree.sha);
    //    console.log("🧱 Creating commit…");

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

    //    console.log("📌 New commit SHA:", commit.sha);
    //    console.log("🔧 Updating branch ref…");

    await githubRequest(
      token,
      `/repos/${login}/${GITHUB_REPO}/git/refs/heads/${branch}`,
      "PATCH",
      { sha: commit.sha },
    );

    console.log("✅ Commit complete");
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

router.post("/pr", async (req, res) => {
  const login = req.query.login as string;
  const workspace = req.query.workspace as string;
  const { description } = req.body;

  console.log("============================================================");
  console.log("📥 /pr request");
  console.log("👤 User:", login);
  console.log("🗂 Workspace:", workspace);
  console.log("============================================================");

  try {
    const token = getTokenForUser(login);
    const branch = `${workspace}`;

    console.log("🔍 Checking for existing PR…");

    const prs = await githubRequest(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls?head=${login}:${branch}&state=open`,
    );

    let pr;
    let created: boolean;

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

    console.log("✅ PR ready:", pr.html_url);

    // Status uses the pr_created/pr_updated vocabulary the frontend's
    // PRResponse type actually switches on — this used to send
    // { number, url, state } instead, which the frontend's handler never
    // matched, so a successful PR submission produced no visible banner.
    res.json({
      status: created ? "pr_created" : "pr_updated",
      prNumber: pr.number,
      url: pr.html_url,
    });
  } catch (err) {
    console.error("❌ PR failed:", err);
    res.status(500).json({ status: "error", error: "Failed to create/update PR" });
  }
});

/* ============================================================
   3. GITHUB REQUEST
   ============================================================ */
export async function githubRequest(token, path, method = "GET", body?) {
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
    const text = await res.text();
    throw new Error(`GitHub API error: ${res.status} ${text}`);
  }

  return await res.json();
}

export default router;
