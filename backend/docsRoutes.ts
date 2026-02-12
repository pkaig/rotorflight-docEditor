// docsRoutes.ts
import express from "express";
import { githubRequest } from "./githubClient";
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_DEFAULT_BRANCH,
} from "./config/github";
import { getAccessTokenOrThrow } from "./authRoutes";

const router = express.Router();

// Submit PR
router.post("/submit-pr", async (req, res) => {
  try {
    const token = getAccessTokenOrThrow();
    const { branch, commitMessage, prBody } = req.body;

    // Assumes you've already committed to `branch` via /save or /rename
    const pr = await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls`,
      {
        method: "POST",
        body: JSON.stringify({
          title: commitMessage || "Docs update",
          body: prBody || "",
          head: branch, // e.g. "user:feature-branch"
          base: GITHUB_DEFAULT_BRANCH,
        }),
      },
    );

    res.json({ ok: true, pr });
  } catch (err) {
    console.error("PR submit failed:", err);
    res.status(500).json({ error: "PR submit failed" });
  }
});

// Helper: get file content + sha
async function getFile(token: string, path: string) {
  return githubRequest<{
    content: string;
    sha: string;
    encoding: string;
  }>(
    token,
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(
      path,
    )}?ref=${GITHUB_DEFAULT_BRANCH}`,
  );
}

// List docs (you can refine this later)
router.get("/list", async (req, res) => {
  try {
    let token;
    try {
      token = getAccessTokenOrThrow();
    } catch {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const files = await githubRequest<any[]>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/docs`,
    );

    const docs = files
      .filter((f) => f.type === "file" && f.name.endsWith(".mdx"))
      .map((f) => ({
        id: f.sha,
        title: f.name,
        path: f.path,
        download_url: f.download_url,
      }));

    res.json({ docs });
  } catch (err) {
    console.error("List loader failed:", err);
    res.status(500).json({ error: "Failed to list docs" });
  }
});

// Load a doc
router.get("/load", async (req, res) => {
  try {
    const token = getAccessTokenOrThrow();
    const path = String(req.query.path);

    const file = await getFile(token, path);
    const content = Buffer.from(
      file.content,
      file.encoding as BufferEncoding,
    ).toString("utf8");

    res.json({ content, sha: file.sha });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load doc" });
  }
});

// Save (create/update) a doc
router.post("/save", async (req, res) => {
  try {
    const token = getAccessTokenOrThrow();
    const { path, content, commitMessage } = req.body;

    // Try to get existing file to obtain sha
    let sha: string | undefined;
    try {
      const existing = await getFile(token, path);
      sha = existing.sha;
    } catch {
      sha = undefined;
    }

    const encoded = Buffer.from(content, "utf8").toString("base64");

    const result = await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(
        path,
      )}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: commitMessage || `Update ${path}`,
          content: encoded,
          sha,
          branch: GITHUB_DEFAULT_BRANCH,
        }),
      },
    );

    res.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save doc" });
  }
});

// Move or New Doc (pure GitHub API)
router.post("/rename", async (req, res) => {
  try {
    const token = getAccessTokenOrThrow();
    const { oldPath, newPath, commitMessage } = req.body;

    // 1. Load old file
    const file = await getFile(token, oldPath);
    const content = Buffer.from(
      file.content,
      file.encoding as BufferEncoding,
    ).toString("utf8");

    const encoded = Buffer.from(content, "utf8").toString("base64");

    // 2. Create new file
    await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(
        newPath,
      )}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: commitMessage || `Move ${oldPath} → ${newPath}`,
          content: encoded,
          branch: GITHUB_DEFAULT_BRANCH,
        }),
      },
    );

    // 3. Delete old file
    await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(
        oldPath,
      )}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: commitMessage || `Delete ${oldPath}`,
          sha: file.sha,
          branch: GITHUB_DEFAULT_BRANCH,
        }),
      },
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("Rename failed:", err);
    res.status(500).json({ error: "Rename failed" });
  }
});

export default router;
