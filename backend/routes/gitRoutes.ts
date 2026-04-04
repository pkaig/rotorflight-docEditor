// ./routes/gitRoutes.ts
import express from "express";
import { getTokenForUser, assertRepoScope } from "./authRoutes";
//import { githubRequest } from "../githubClient";
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
async function ensureFork(token: string, login: string) {
  let forkExists = false;

  // FIRST: check if fork exists
  try {
    const fork = await githubRequest(token, `/repos/${login}/${GITHUB_REPO}`);
    console.log("Fork already exists:", fork.full_name);
    forkExists = true;
  } catch (err) {
    console.log("❗ GET /repos/<login>/<repo> failed:", err);
  }

  // IF fork does not exist, create it
  if (!forkExists) {
    console.log("⚠️ Fork missing — creating fork from upstream…");
    console.log("Owner:", GITHUB_OWNER);
    console.log("Repo:", GITHUB_REPO);

    const forkResp = await githubRequest(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/forks`,
      "POST",
      { default_branch_only: true },
    );

    //console.log("📨 /forks response:", forkResp);
  }

  console.log("⏳ Waiting for fork to become ready…");
}

// Ensure a workspace branch exists in the user's fork
async function ensureBranch(token: string, login: string, branch: string) {
  console.log(
    `🔍 ensureBranch(): checking branch "${branch}" in fork ${login}/${GITHUB_REPO}`,
  );

  try {
    const ref = await githubRequest(
      token,
      `/repos/${login}/${GITHUB_REPO}/git/refs/heads/${branch}`,
    );
    console.log("✅ Branch exists:", ref.ref);
    return ref;
  } catch {
    console.log(`⚠️ Branch "${branch}" missing — creating from upstream main`);
  }

  console.log(
    "🔍 Fetching upstream base branch:",
    `${GITHUB_OWNER}/${GITHUB_REPO}:${GITHUB_DEFAULT_BRANCH}`,
  );

  const base = await githubRequest(
    token,
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${GITHUB_DEFAULT_BRANCH}`,
  );

  console.log("📌 Upstream base SHA:", base.object.sha);

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

  console.log("🔄 Re-fetching new branch…");

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

    if (prs.length > 0) {
      console.log("✏️ Updating existing PR:", prs[0].number);

      pr = await githubRequest(
        token,
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls/${prs[0].number}`,
        "PATCH",
        { body: description },
      );
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
    }

    console.log("✅ PR ready:", pr.html_url);

    res.json({
      number: pr.number,
      url: pr.html_url,
      state: pr.state,
    });
  } catch (err) {
    console.error("❌ PR failed:", err);
    res.status(500).json({ error: "Failed to create/update PR" });
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
