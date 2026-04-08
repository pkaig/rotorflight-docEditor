// resetMirror.ts
import express from "express";
import * as fs from "fs-extra";
import crypto from "crypto";
import simpleGit from "simple-git";

import path from "path";
import fetch from "node-fetch";
import { getTokenForUser } from "./authRoutes";
//import { computeUpstreamDiff } from "../merge/computeUpstreamDiff";
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_DEFAULT_BRANCH,
} from "../config/github";

function hashFile(buf: Buffer | string) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full);
      if (e.isDirectory()) {
        await walk(full);
      } else {
        out.push(rel.replace(/\\/g, "/"));
      }
    }
  }

  if (await fs.pathExists(root)) {
    await walk(root);
  }

  return out;
}

type UpstreamChange =
  | { type: "added"; file: string }
  | { type: "modified"; file: string }
  | { type: "deleted"; file: string };

async function computeUpstreamDiff(
  base: string,
  theirs: string,
): Promise<UpstreamChange[]> {
  const baseFiles = await listFilesRecursive(base);
  const theirFiles = await listFilesRecursive(theirs);

  const baseSet = new Set(baseFiles);
  const theirSet = new Set(theirFiles);

  const changes: UpstreamChange[] = [];

  // added or modified
  for (const f of theirFiles) {
    const theirsPath = path.join(theirs, f);
    const theirsBuf = await fs.readFile(theirsPath);
    const theirsHash = hashFile(theirsBuf);

    if (!baseSet.has(f)) {
      changes.push({ type: "added", file: f });
      continue;
    }

    const basePath = path.join(base, f);
    const baseBuf = await fs.readFile(basePath);
    const baseHash = hashFile(baseBuf);

    if (baseHash !== theirsHash) {
      changes.push({ type: "modified", file: f });
    }
  }

  // deleted
  for (const f of baseFiles) {
    if (!theirSet.has(f)) {
      changes.push({ type: "deleted", file: f });
    }
  }

  return changes;
}

type WorkspaceMergeResult = {
  applied: string[];
  conflicts: string[];
  deleted: string[];
};

async function applyUpstreamToWorkspace(
  workspacePath: string,
  base: string,
  theirs: string,
  upstream: UpstreamChange[],
): Promise<WorkspaceMergeResult> {
  const applied: string[] = [];
  const conflicts: string[] = [];
  const deleted: string[] = [];

  for (const change of upstream) {
    const rel = change.file;
    const baseFile = path.join(base, rel);
    const theirsFile = path.join(theirs, rel);
    const wsFile = path.join(workspacePath, rel);
    const wsConflictFile = wsFile + ".conflict";

    if (change.type === "deleted") {
      // if user hasn't touched it, delete from workspace
      if (await fs.pathExists(wsFile)) {
        const [baseBuf, wsBuf] = await Promise.all([
          fs.pathExists(baseFile)
            ? fs.readFile(baseFile)
            : Promise.resolve(Buffer.alloc(0)),
          fs.readFile(wsFile),
        ]);

        const baseHash = hashFile(baseBuf);
        const wsHash = hashFile(wsBuf);

        if (baseHash === wsHash) {
          await fs.remove(wsFile);
          deleted.push(rel);
        } else {
          // user changed it; leave it, no conflict file for deletes
        }
      }
      continue;
    }

    // added / modified
    const theirsBuf = await fs.readFile(theirsFile);
    const theirsHash = hashFile(theirsBuf);

    const baseBuf = (await fs.pathExists(baseFile))
      ? await fs.readFile(baseFile)
      : Buffer.alloc(0);
    const baseHash = hashFile(baseBuf);

    const wsExists = await fs.pathExists(wsFile);

    if (!wsExists) {
      // workspace didn't have it: just write theirs
      await fs.ensureDir(path.dirname(wsFile));
      await fs.writeFile(wsFile, theirsBuf);
      applied.push(rel);
      continue;
    }

    const wsBuf = await fs.readFile(wsFile);
    const wsHash = hashFile(wsBuf);

    // workspace unchanged vs base → safe to apply theirs
    if (wsHash === baseHash) {
      await fs.writeFile(wsFile, theirsBuf);
      applied.push(rel);
      continue;
    }

    // workspace changed vs base
    if (wsHash === theirsHash) {
      // user already matches upstream; nothing to do
      continue;
    }

    // true conflict: user changed and upstream changed differently
    await fs.ensureDir(path.dirname(wsConflictFile));
    await fs.writeFile(wsConflictFile, theirsBuf);
    conflicts.push(rel);
  }

  return { applied, conflicts, deleted };
}

const router = express.Router();

function requireToken(req, res) {
  const login = req.query.login as string;

  if (!login) {
    res.status(401).json({ error: "Missing login" });
    return null;
  }

  try {
    const token = getTokenForUser(login);
    return { login, token };
  } catch {
    res.status(401).json({ error: "User not authenticated" });
    return null;
  }
}

async function githubJson(url: string, token: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "mirror-refresh",
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${url}`);
  return res.json();
}

async function downloadGithubFile(file: any, token: string): Promise<Buffer> {
  if (file.encoding === "base64" && file.content) {
    return Buffer.from(file.content, "base64");
  }

  if (file.download_url) {
    const res = await fetch(file.download_url, {
      headers: {
        "User-Agent": "mirror-refresh",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) throw new Error(`Failed to download ${file.path}`);
    return Buffer.from(await res.arrayBuffer());
  }

  console.warn("Unknown GitHub file encoding:", file.path);
  return Buffer.alloc(0);
}

async function walkGithubTree(treeUrl: string, baseDir: string, token: string) {
  const treeData = await githubJson(treeUrl, token);

  for (const item of treeData.tree) {
    const localPath = path.join(baseDir, item.path);

    if (item.type === "tree") {
      await fs.ensureDir(localPath);
      continue;
    }

    if (item.type === "blob") {
      const file = await githubJson(item.url, token);
      const data = await downloadGithubFile(file, token);

      await fs.ensureDir(path.dirname(localPath));
      await fs.writeFile(localPath, data);

      console.log("Wrote", item.path, data.length, "bytes");
    }
  }
}

/* ---------------------------------------------
 reset the global mirror
 ---------------------------------------------*/
router.post("/", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login, token } = auth;
  const mirrorPath = path.join(process.cwd(), "Rotorflight-docs", "mirror");

  try {
    console.log("RESET-MIRROR: deleting old mirror...");
    await fs.remove(mirrorPath);

    console.log("RESET-MIRROR: cloning repo...");
    await simpleGit().clone(
      `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git`,
      mirrorPath,
      ["--depth=1"],
    );

    // fetch upstream SHA
    const commit = await githubJson(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits/${GITHUB_DEFAULT_BRANCH}`,
      token,
    );

    // write hash file
    await fs.writeFile(
      path.join(mirrorPath, ".upstream-hash"),
      commit.sha,
      "utf8",
    );

    console.log("RESET-MIRROR: global mirror updated.");

    // ---------------------------------------------
    // REBASE ALL WORKSPACES
    // ---------------------------------------------
    console.log("RESET-MIRROR: rebasing all workspaces...");

    const workspacesRoot = path.join(process.cwd(), "workspaces");
    if (await fs.pathExists(workspacesRoot)) {
      const users = await fs.readdir(workspacesRoot);

      for (const user of users) {
        const userPath = path.join(workspacesRoot, user);
        const workspaceNames = await fs.readdir(userPath);

        for (const name of workspaceNames) {
          console.log(`Rebasing workspace ${user}/${name}...`);

          await fetch(
            `http://localhost:${process.env.PORT || 4000}/api/reset-mirror/rebase-all-workspace?login=${encodeURIComponent(
              user,
            )}&workspace=${encodeURIComponent(name)}`,
            { method: "POST" },
          );
        }
      }
    }

    console.log("RESET-MIRROR: all workspaces rebased.");
    return res.json({ ok: true });
  } catch (err) {
    console.error("RESET-MIRROR ERROR:", err);
    return res.status(500).json({ error: "Mirror rebuild failed" });
  }
});

/* ---------------------------------------------
 Load the workspace mirror
 ---------------------------------------------*/
router.post("/load-workspace-mirror", async (req, res) => {
  const login = req.query.login as string;
  const workspace = req.query.workspace as string;

  if (!login || !workspace) {
    return res.status(400).json({ error: "Missing login or workspace" });
  }

  try {
    const globalMirror = path.join(process.cwd(), "Rotorflight-docs", "mirror");
    const workspaceRoot = path.join(
      process.cwd(),
      "workspaces",
      login,
      workspace,
    );
    const workspaceMirror = path.join(workspaceRoot, "mirror");

    await fs.rm(workspaceMirror, { recursive: true, force: true });
    await fs.ensureDir(workspaceMirror);

    await fs.copy(globalMirror, workspaceMirror);

    return res.json({ ok: true });
  } catch (err) {
    console.error("load-workspace-mirror error:", err);
    return res.status(500).json({ error: "Failed to load workspace mirror" });
  }
});

/* -------------------------------------
  REBASE WORKSPACE
  -----------------------------------*/
router.post("/rebase-all-workspace", async (req, res) => {
  const login = req.query.login as string;
  const workspace = req.query.workspace as string;

  if (!login || !workspace) {
    return res.status(400).json({ error: "Missing login or workspace" });
  }

  try {
    const workspaceRoot = path.join(
      process.cwd(),
      "workspaces",
      login,
      workspace,
    );

    const baseline = path.join(workspaceRoot, "mirror"); // old upstream snapshot
    const upstream = path.join(process.cwd(), "Rotorflight-docs", "mirror"); // new upstream snapshot

    const docsPath = path.join(workspaceRoot, "docs");
    const versionedPath = path.join(workspaceRoot, "versioned_docs");

    // 1. Compute diff between old baseline and new upstream
    const diff = await computeUpstreamDiff(baseline, upstream);

    const result: any = {
      docs: [],
      versioned: [],
      diffCount: diff.length,
    };

    // 2. Apply upstream changes to docs/
    let docsResult: WorkspaceMergeResult | null = null;
    if (await fs.pathExists(docsPath)) {
      const docsDiff = diff
        .filter((c) => c.file.startsWith("docs/"))
        .map((c) => ({
          ...c,
          file: c.file.slice("docs/".length),
        }));

      if (docsDiff.length > 0) {
        docsResult = await applyUpstreamToWorkspace(
          docsPath,
          path.join(baseline, "docs"),
          path.join(upstream, "docs"),
          docsDiff,
        );
        result.docs = docsResult;
      }
    }

    // 3. Apply upstream changes to versioned_docs/
    let versionedResult: WorkspaceMergeResult | null = null;
    if (await fs.pathExists(versionedPath)) {
      const versionedDiff = diff
        .filter((c) => c.file.startsWith("versioned_docs/"))
        .map((c) => ({
          ...c,
          file: c.file.slice("versioned_docs/".length),
        }));

      if (versionedDiff.length > 0) {
        versionedResult = await applyUpstreamToWorkspace(
          versionedPath,
          path.join(baseline, "versioned_docs"),
          path.join(upstream, "versioned_docs"),
          versionedDiff,
        );
        result.versioned = versionedResult;
      }
    }

    // 4. Incrementally update baseline to match new upstream
    //    - clean merges: baseline = upstream
    //    - deletes: remove from baseline
    //    - conflicts: leave baseline as-is (Option C)

    // docs/
    if (docsResult) {
      const baselineDocs = path.join(baseline, "docs");
      const upstreamDocs = path.join(upstream, "docs");

      // applied → copy from upstream into baseline
      for (const rel of docsResult.applied) {
        const src = path.join(upstreamDocs, rel);
        const dst = path.join(baselineDocs, rel);
        await fs.ensureDir(path.dirname(dst));
        await fs.copy(src, dst);
      }

      // deleted → remove from baseline
      for (const rel of docsResult.deleted) {
        const dst = path.join(baselineDocs, rel);
        await fs.remove(dst);
      }

      // conflicts → do nothing in baseline (keep old snapshot)
    }

    // versioned_docs/
    if (versionedResult) {
      const baselineVersioned = path.join(baseline, "versioned_docs");
      const upstreamVersioned = path.join(upstream, "versioned_docs");

      // applied → copy from upstream into baseline
      for (const rel of versionedResult.applied) {
        const src = path.join(upstreamVersioned, rel);
        const dst = path.join(baselineVersioned, rel);
        await fs.ensureDir(path.dirname(dst));
        await fs.copy(src, dst);
      }

      // deleted → remove from baseline
      for (const rel of versionedResult.deleted) {
        const dst = path.join(baselineVersioned, rel);
        await fs.remove(dst);
      }

      // conflicts → do nothing in baseline
    }

    return res.json({ ok: true, result });
  } catch (err) {
    console.error("REBASE ERROR:", err);
    return res.status(500).json({ error: "Rebase failed" });
  }
});

/* -------------------------------------
  Set Conflict files
  -----------------------------------*/
router.get("/conflict-file", async (req, res) => {
  const login = req.query.login as string;
  const workspace = req.query.workspace as string;
  const file = req.query.file as string;

  const wsPath = path.join(
    process.cwd(),
    "workspaces",
    login,
    workspace,
    "docs",
    file,
  );

  const conflictPath = wsPath + ".conflict";

  try {
    const workspaceText = await fs.readFile(wsPath, "utf8");
    const upstreamText = await fs.readFile(conflictPath, "utf8");

    return res.json({ workspace: workspaceText, upstream: upstreamText });
  } catch (err) {
    console.error("conflict-file error:", err);
    return res.status(500).json({ error: "Failed to load conflict file" });
  }
});

/* -------------------------------------
  Resolve Conflict files
  -----------------------------------*/
router.post("/resolve-conflict", async (req, res) => {
  const { login, workspace, file, resolution, content } = req.body;

  if (!login || !workspace || !file) {
    return res.status(400).json({ error: "Missing login, workspace, or file" });
  }

  const wsPath = path.join(
    process.cwd(),
    "workspaces",
    login,
    workspace,
    "docs",
    file,
  );

  const conflictPath = wsPath + ".conflict";

  try {
    if (resolution === "workspace") {
      await fs.remove(conflictPath);
    }

    if (resolution === "upstream") {
      const upstream = await fs.readFile(conflictPath);
      await fs.writeFile(wsPath, upstream);
      await fs.remove(conflictPath);
    }

    if (resolution === "manual") {
      await fs.writeFile(wsPath, content);
      await fs.remove(conflictPath);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("resolve-conflict error:", err);
    return res.status(500).json({ error: "Failed to resolve conflict" });
  }
});

/* ---------------------------------------------
 The file has a conflict
 ---------------------------------------------*/
router.get("/has-conflict", async (req, res) => {
  const { login, workspace, file } = req.query;

  const wsPath = path.join(
    process.cwd(),
    "workspaces",
    login,
    workspace,
    "docs",
    file,
  );

  const conflictPath = wsPath + ".conflict";

  const exists = await fs.pathExists(conflictPath);
  return res.json({ conflict: exists });
});

/* ---------------------------------------------
 Check current Rotorflight-docs Hash
 ---------------------------------------------*/
export async function ensureMirrorUpToDate(token: string) {
  const mirrorPath = path.join(process.cwd(), "Rotorflight-docs", "mirror");
  const hashFile = path.join(mirrorPath, ".upstream-hash");

  // 1. Fetch latest upstream SHA
  const commit = await githubJson(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits/${GITHUB_DEFAULT_BRANCH}`,
    token,
  );
  const upstreamSha = commit.sha;

  // 2. Read local SHA
  let localSha = null;
  if (await fs.pathExists(hashFile)) {
    localSha = (await fs.readFile(hashFile, "utf8")).trim();
  }

  // 3. If same → nothing to do
  if (localSha === upstreamSha) {
    console.log("Mirror already up to date:", upstreamSha);
    return;
  }

  // 4. Otherwise rebuild mirror
  console.log("Mirror stale — rebuilding…");

  await fs.remove(mirrorPath);
  await simpleGit().clone(
    `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git`,
    mirrorPath,
    ["--depth=1"],
  );

  await fs.writeFile(hashFile, upstreamSha, "utf8");
  console.log("Mirror updated to", upstreamSha);
}

/* ---------------------------------------------
 CHECK STATUS
 ---------------------------------------------*/
router.get("/upstream-status", async (req, res) => {
  const login = req.query.login as string;
  if (!login) return res.status(400).json({ error: "Missing login" });

  try {
    const token = getTokenForUser(login);

    const mirrorPath = path.join(process.cwd(), "Rotorflight-docs", "mirror");
    const hashFile = path.join(mirrorPath, ".upstream-hash");

    // Mirror missing → stale
    if (!(await fs.pathExists(mirrorPath))) {
      return res.json({ stale: true, reason: "no-mirror" });
    }

    // Hash missing → stale
    if (!(await fs.pathExists(hashFile))) {
      return res.json({ stale: true, reason: "no-hash" });
    }

    // Fetch upstream SHA
    const commit = await githubJson(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits/${GITHUB_DEFAULT_BRANCH}`,
      token,
    );
    const upstreamSha = commit.sha;

    // Read local SHA
    const localSha = (await fs.readFile(hashFile, "utf8")).trim();

    return res.json({
      stale: upstreamSha !== localSha,
      upstreamSha,
      localSha,
    });
  } catch (err) {
    console.error("upstream-status error:", err);
    return res.status(500).json({ error: "Failed to check upstream status" });
  }
});

export default router;
