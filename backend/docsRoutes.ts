import express from "express";
import { githubRequest } from "./githubClient";
import { getTokenForUser } from "./authRoutes";
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_DEFAULT_BRANCH,
} from "./config/github";
import { scanImages } from "./scanImages";

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
// LIST DOCUMENTS (recursive, MD/MDX)
// ---------------------------------------------
router.get("/list", async (req, res) => {
  console.log("📥 /api/docs/list HIT");

  const auth = requireToken(req, res);
  if (!auth) return;

  const { token } = auth;

  // -----------------------------
  // RECURSIVE WALKER
  // -----------------------------
  async function walk(path: string) {
    const apiPath =
      path === ""
        ? `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents?ref=${GITHUB_DEFAULT_BRANCH}`
        : `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_DEFAULT_BRANCH}`;

    let items;
    try {
      items = await githubRequest<any>(token, apiPath);
    } catch (err: any) {
      console.log(`❌ GitHub error at ${path}:`, err?.status || err);
      return null;
    }

    if (!Array.isArray(items)) items = [items];

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
  // PRUNE EMPTY FOLDERS
  // -----------------------------
  function prune(node) {
    if (node.type === "file") return true;
    node.children = node.children.filter(prune);
    return node.children.length > 0;
  }

  // -----------------------------
  // FLATTEN TREE → FILE PATHS
  // -----------------------------
  function flatten(node, list = []) {
    if (node.type === "file") {
      list.push(node.path);
      return list;
    }
    for (const child of node.children) flatten(child, list);
    return list;
  }

  // -----------------------------
  // LOAD FILE CONTENT
  // -----------------------------
  async function loadDocContent(filePath: string) {
    const result = await githubRequest<any>(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_DEFAULT_BRANCH}`,
    );
    return Buffer.from(result.content, "base64").toString("utf8");
  }

  // -----------------------------
  // EXECUTE
  // -----------------------------
  try {
    const tree = await walk("docs");
    if (!tree) return res.json({ docs: [] });

    prune(tree);

    // -----------------------------
    // IMAGE SCANNING PHASE
    // -----------------------------
    const filePaths = flatten(tree);
    const allImages = new Set<string>();

    for (const filePath of filePaths) {
      const content = await loadDocContent(filePath);
      const imgs = scanImages(content, filePath);
      imgs.forEach((img) => allImages.add(img));
    }

    // -----------------------------
    // PRELOAD IMAGES
    // -----------------------------
    await fetch("http://localhost:4000/api/images/preload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: [...allImages] }),
    });

    // Return the tree
    res.json({ docs: [tree] });
  } catch (err) {
    console.error("❌ Failed to list docs:", err);
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

// (SAVE, RENAME, SUBMIT PR unchanged…)

export default router;
