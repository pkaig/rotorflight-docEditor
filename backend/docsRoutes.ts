import express from "express";
import { githubRequest } from "./githubClient";
import { getTokenForUser } from "./authRoutes";
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_DEFAULT_BRANCH,
} from "./config/github";

const router = express.Router();

// ---------------------------------------------
// Helper: Require login + load token
// ---------------------------------------------
function requireToken(req, res) {
  const login = req.query.login as string;
  if (!login) {
    res.status(401).json({ error: "Missing login" });
    return null;
  }

  try {
    const token = getTokenForUser(login);
    return { token, login };
  } catch {
    res.status(401).json({ error: "User not authenticated" });
    return null;
  }
}

// ---------------------------------------------
// LIST DOCUMENTS (recursive, MD/MDX, stable version)
// ---------------------------------------------
router.get("/list", async (req, res) => {
  console.log("📥 /api/docs/list HIT");

  const auth = requireToken(req, res);
  if (!auth) return;

  const { token } = auth;

  // -----------------------------
  // RECURSIVE WALKER (collect everything)
  // -----------------------------
  async function walk(path: string) {
    //console.log(`\n➡️ ENTER: ${path}`);

    const apiPath =
      path === ""
        ? `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents?ref=${GITHUB_DEFAULT_BRANCH}`
        : `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_DEFAULT_BRANCH}`;

    let items;

    try {
      items = await githubRequest<any>(token, apiPath);
    } catch (err: any) {
      console.log(`   ❌ GitHub error at ${path}:`, err?.status || err);
      return null;
    }

    if (!Array.isArray(items)) {
      items = [items];
    }

    const node = {
      type: "dir",
      name: path.split("/").pop() || "root",
      path,
      children: [] as any[],
    };

    for (const item of items) {
      if (item.type === "dir") {
        const child = await walk(item.path);
        if (child) node.children.push(child);
      }

      if (item.type === "file") {
        const isDoc = item.name.endsWith(".md") || item.name.endsWith(".mdx");

        // console.log(
        //   `   📄 File ${item.path} → ${isDoc ? "ACCEPTED" : "ignored"}`,
        // );

        if (isDoc) {
          node.children.push({
            type: "file",
            name: item.name,
            path: item.path,
          });
        }
      }
    }

    return node;
  }

  // -----------------------------
  // PRUNE PHASE (remove empty folders)
  // -----------------------------
  function prune(node) {
    if (node.type === "file") return true;

    node.children = node.children.filter(prune);

    const keep = node.children.length > 0;

    //    console.log(`   🧹 PRUNE: ${node.path} → ${keep ? "KEEP" : "REMOVE"}`);

    return keep;
  }

  // -----------------------------
  // EXECUTE
  // -----------------------------
  try {
    // console.log("\n🚀 START WALK");
    const tree = await walk("docs");

    if (!tree) {
      // console.log("❌ Walker returned null");
      return res.json({ docs: [] });
    }

    prune(tree);

    // console.log("\n✅ FINAL TREE:");
    // console.log(JSON.stringify(tree, null, 2));

    res.json({ docs: [tree] });
  } catch (err) {
    // console.error("❌ Failed to list docs:", err);
    res.status(500).json({ error: "Failed to list docs" });
  }
});

// ---------------------------------------------
// LOAD DOCUMENT
// ---------------------------------------------
router.get("/load", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { token } = auth;
  const filePath = req.query.path as string;

  try {
    const result = await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_DEFAULT_BRANCH}`,
    );

    const content = Buffer.from(result.content, "base64").toString("utf8");
    res.json({ content });
  } catch (err) {
    console.error("Failed to load doc:", err);
    res.status(500).json({ error: "Failed to load document" });
  }
});

// ---------------------------------------------
// SAVE DOCUMENT
// ---------------------------------------------
router.post("/save", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { token } = auth;
  const { path: filePath, content, commitMessage, email } = req.body;

  try {
    const existing = await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_DEFAULT_BRANCH}`,
    );

    const sha = existing.sha;

    const body = {
      message: commitMessage || "Update file",
      content: Buffer.from(content).toString("base64"),
      sha,
      branch: GITHUB_DEFAULT_BRANCH,
      committer: {
        name: email || "Rotorflight Docs Editor",
        email: email || "noreply@rotorflight.org",
      },
    };

    const result = await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
      "PUT",
      body,
    );

    res.json({ saved: true, result });
  } catch (err) {
    console.error("Failed to save doc:", err);
    res.status(500).json({ error: "Failed to save document" });
  }
});

// ---------------------------------------------
// RENAME DOCUMENT
// ---------------------------------------------
router.post("/rename", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { token } = auth;
  const { oldPath, newPath } = req.body;

  try {
    const existing = await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${oldPath}?ref=${GITHUB_DEFAULT_BRANCH}`,
    );

    await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${newPath}`,
      "PUT",
      {
        message: `Rename ${oldPath} → ${newPath}`,
        content: existing.content,
        branch: GITHUB_DEFAULT_BRANCH,
      },
    );

    await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${oldPath}`,
      "DELETE",
      {
        message: `Remove old file ${oldPath}`,
        sha: existing.sha,
        branch: GITHUB_DEFAULT_BRANCH,
      },
    );

    res.json({ renamed: true });
  } catch (err) {
    console.error("Failed to rename doc:", err);
    res.status(500).json({ error: "Failed to rename document" });
  }
});

// ---------------------------------------------
// SUBMIT PR
// ---------------------------------------------
router.post("/submit-pr", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { token, login } = auth;
  const {
    path: filePath,
    content,
    commitMessage,
    prBody,
    branch,
    email,
  } = req.body;

  try {
    const baseRef = await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_DEFAULT_BRANCH}`,
    );

    await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`,
      "POST",
      {
        ref: `refs/heads/${branch}`,
        sha: baseRef.object.sha,
      },
    );

    const encoded = Buffer.from(content).toString("base64");

    await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
      "PUT",
      {
        message: commitMessage,
        content: encoded,
        branch,
        committer: {
          name: email || login,
          email: email || `${login}@users.noreply.github.com`,
        },
      },
    );

    const pr = await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls`,
      "POST",
      {
        title: commitMessage,
        body: prBody,
        head: branch,
        base: GITHUB_DEFAULT_BRANCH,
      },
    );

    res.json({ pr });
  } catch (err) {
    console.error("Failed to submit PR:", err);
    res.status(500).json({ error: "Failed to submit PR" });
  }
});

export default router;
