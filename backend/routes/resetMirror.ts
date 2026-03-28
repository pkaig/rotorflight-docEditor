import express from "express";
import * as fs from "fs-extra";

import path from "path";
import fetch from "node-fetch";
import { getTokenForUser } from "./authRoutes";
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_DEFAULT_BRANCH,
} from "../config/github";

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

import simpleGit from "simple-git";

router.post("/reset-mirror", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login } = auth;
  const mirrorPath = path.join(process.cwd(), "workspaces", login, "mirror");

  try {
    console.log("RESET-MIRROR: deleting old mirror...");
    await fs.remove(mirrorPath);

    console.log("RESET-MIRROR: cloning repo...");
    await simpleGit().clone(
      `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git`,
      mirrorPath,
      ["--depth=1"],
    );

    console.log("RESET-MIRROR: complete.");
    return res.json({ ok: true });
  } catch (err) {
    console.error("RESET-MIRROR ERROR:", err);
    return res.status(500).json({ error: "Mirror rebuild failed" });
  }
});

router.post("/merge-all-workspaces", async (req, res) => {
  try {
    const base = path.join(process.cwd(), "mirror-old");
    const theirs = path.join(process.cwd(), "mirror");
    const workspacesRoot = path.join(process.cwd(), "workspaces");

    console.log("MERGE: computing upstream diff...");
    const upstream = await computeUpstreamDiff(base, theirs);

    console.log("MERGE: applying upstream diff to all workspaces...");
    const workspaceNames = await fs.readdir(workspacesRoot);

    const results = [];

    for (const name of workspaceNames) {
      const workspacePath = path.join(workspacesRoot, name, "workspace");

      if (!(await fs.pathExists(workspacePath))) continue;

      const result = await applyUpstreamToWorkspace(
        workspacePath,
        base,
        theirs,
        upstream,
      );

      results.push({ workspace: name, ...result });
    }

    return res.json({ ok: true, results });
  } catch (err) {
    console.error("MERGE ERROR:", err);
    return res.status(500).json({ error: "Merge failed" });
  }
});

export default router;
