import express from "express";
import { githubRequest } from "./githubClient";
import { getTokenForUser } from "./authRoutes";
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_DEFAULT_BRANCH,
} from "./config/github";
import path from "path";
import fs from "fs";
import multer from "multer";

type TreeNode = {
  type: "dir" | "file";
  name: string;
  path: string;
  children?: TreeNode[];
  error?: boolean;
};

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const routesDebug = true;

// ---------------------------------------------
// GitHub recursive walker (token passed explicitly)
// ---------------------------------------------
async function walk(currentPath: string, token: string) {
  const apiPath =
    currentPath === ""
      ? `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents?ref=${GITHUB_DEFAULT_BRANCH}`
      : `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${currentPath}?ref=${GITHUB_DEFAULT_BRANCH}`;

  let items;
  try {
    items = await githubRequest<any>(token, apiPath);
  } catch {
    return null;
  }

  if (!Array.isArray(items)) items = [items];

  const node = {
    type: "dir",
    name: currentPath.split("/").pop() || "root",
    path: `Rotorflight-docs/${currentPath}`,
    children: [] as any[],
  };

  for (const item of items) {
    if (item.type === "dir") {
      const child = await walk(item.path, token);
      if (child) node.children.push(child);
    }

    if (item.type === "file") {
      const isDoc = item.name.endsWith(".md") || item.name.endsWith(".mdx");
      const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(item.name);

      if (isDoc || isImage) {
        node.children.push({
          type: "file",
          name: item.name,
          path: `Rotorflight-docs/${item.path}`,
        });
      }
    }
  }

  return node;
}

// ---------------------------------------------
// Helper: Require login + ensure workspace root
// ---------------------------------------------
function requireToken(req, res) {
  const login = req.query.login as string;
  if (!login) {
    res.status(401).json({ error: "Missing login" });
    return null;
  }

  try {
    const token = getTokenForUser(login);

    // Workspace root is now: workspaces/<login>/
    const workspaceRoot = path.join(process.cwd(), "workspaces", login);
    fs.mkdirSync(workspaceRoot, { recursive: true });

    return { token, login };
  } catch {
    res.status(401).json({ error: "User not authenticated" });
    return null;
  }
}

function extractImagePaths(mdx) {
  const patterns = [
    /!\[[^\]]*\]\(([^)]+\.(?:png|jpe?g|gif|svg|webp|mp4|webm))\)/g,
    /<img[^>]+src=["']([^"']+\.(?:png|jpe?g|gif|svg|webp))["']/g,
    /import\s+[A-Za-z0-9_$]+\s+from\s+["']([^"']+\.(?:png|jpe?g|gif|svg|webp|mp4|webm))["']/g,
  ];

  const results = new Set<string>();
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(mdx))) {
      results.add(match[1]);
    }
  }
  return [...results];
}

function resolveDocsPath(docPath, relPath) {
  docPath = docPath.replace(/^Rotorflight-docs\//, "");
  relPath = relPath.replace(/^Rotorflight-docs\//, "");

  const baseDir = docPath.replace(/[^/]+$/, "");
  const combined = baseDir + relPath;

  const parts = combined.split("/").reduce((acc, part) => {
    if (part === "" || part === ".") return acc;
    if (part === "..") {
      acc.pop();
      return acc;
    }
    acc.push(part);
    return acc;
  }, [] as string[]);

  return parts.join("/");
}

// ---------------------------------------------
// Local recursive walker (stable, deterministic)
// ---------------------------------------------
async function walkLocalWorkspace(rootPath: string, prefix: string) {
  async function walkDir(dir: string): Promise<TreeNode> {
    try {
      // --- Safe directory read with logging ---
      //console.time("READ ROOT");
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      // console.timeEnd("READ ROOT");

      const relative = path.relative(rootPath, dir).replace(/\\/g, "/");
      const nodePath = relative ? `${prefix}/${relative}` : prefix;

      const node: TreeNode = {
        type: "dir",
        name: path.basename(dir),
        path: nodePath,
        children: [],
      };

      for (const entry of entries) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const child = await walkDir(full);
          if (child && typeof child === "object") {
            node.children!.push(child);
          }
          continue;
        }

        if (entry.isFile()) {
          const isDoc =
            entry.name.endsWith(".md") || entry.name.endsWith(".mdx");
          const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(entry.name);

          if (isDoc || isImage) {
            const relFile = path.relative(rootPath, full).replace(/\\/g, "/");
            node.children!.push({
              type: "file",
              name: entry.name,
              path: `${prefix}/${relFile}`,
            });
          }
        }
      }

      return node;
    } catch (err) {
      console.error("❌ walkDir failed:", dir, err);

      const relative = path.relative(rootPath, dir).replace(/\\/g, "/");
      const nodePath = relative ? `${prefix}/${relative}` : prefix;

      return {
        type: "dir",
        name: path.basename(dir),
        path: nodePath,
        children: [],
        error: true,
      };
    }
  }

  // --- CRITICAL FIX: ensure root never returns undefined ---
  const rootNode = await walkDir(rootPath);
  return (
    rootNode ?? {
      type: "dir",
      name: path.basename(rootPath),
      path: prefix,
      children: [],
      error: true,
    }
  );
}

// ---------------------------------------------
// Build local-workspace tree (docs + versioned_docs)
// ---------------------------------------------
async function buildLocalWorkspace(login: string) {
  const workspaceRoot = path.join(process.cwd(), "workspaces", login);

  const docsRoot = path.join(workspaceRoot, "docs");
  const versionedRoot = path.join(workspaceRoot, "versioned_docs");

  await fs.promises.mkdir(docsRoot, { recursive: true });
  await fs.promises.mkdir(versionedRoot, { recursive: true });

  const children: TreeNode[] = [];

  try {
    const docsTree = await walkLocalWorkspace(docsRoot, "local-workspace/docs");
    children.push(docsTree);
  } catch {
    console.warn("No local docs folder:", docsRoot);
  }

  try {
    const versionedTree = await walkLocalWorkspace(
      versionedRoot,
      "local-workspace/versioned_docs",
    );
    children.push(versionedTree);
  } catch {
    console.warn("No local versioned_docs folder:", versionedRoot);
  }

  return {
    type: "dir",
    name: "local-workspace",
    path: "local-workspace",
    children,
  } as any;
}

// ---------------------------------------------
// LIST GITHUB DOCUMENTS ONLY
// ---------------------------------------------
router.get("/list-github", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { token } = auth;

  try {
    const tree = await walk("", token);

    if (!tree) {
      return res.json({ docs: [] });
    }

    const allowed = ["docs", "versioned_docs"];

    const githubRoot = {
      type: "dir",
      name: "Rotorflight-docs",
      path: "Rotorflight-docs",
      children: tree.children.filter((child) => allowed.includes(child.name)),
    };

    return res.json({ docs: [githubRoot] });
  } catch (err) {
    console.error("❌ list-github failed:", err);
    return res.status(500).json({ error: "Failed to list GitHub docs" });
  }
});

// ---------------------------------------------
// LIST LOCAL WORKSPACE ONLY
// ---------------------------------------------
router.get("/list-local", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login } = auth;

  try {
    const localTree = await buildLocalWorkspace(login);
    return res.json({ docs: [localTree] });
  } catch (err) {
    console.error("❌ list-local failed:", err);
    return res.status(500).json({ error: "Failed to list local workspace" });
  }
});

// ---------------------------------------------
// LOCAL UPLOAD
// ---------------------------------------------
router.post("/local/upload", upload.single("file"), async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login } = auth;
  const { folder } = req.body;
  const file = req.file;

  if (!folder || !file) {
    return res.status(400).json({ error: "Missing folder or file" });
  }

  const workspaceRoot = path.join(process.cwd(), "workspaces", login);
  const dest = path.join(workspaceRoot, folder, file.originalname);

  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest, file.buffer);

  res.json({
    ok: true,
    path: `${folder}/${file.originalname}`,
  });
});

// ---------------------------------------------
// LOAD DOCUMENT (GitHub or Local)
// ---------------------------------------------
router.get("/load", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { token, login } = auth;
  let filePath = req.query.path as string;

  filePath = filePath.replace(/\\/g, "/");

  try {
    if (filePath.startsWith("local-workspace/")) {
      if (routesDebug) {
        console.log(
          "👣 Walking local-workspace...",
          new Date().getMinutes(),
          ":",
          new Date().getSeconds(),
        );
      }
      const localRelative = filePath.replace(/^local-workspace\//, "");

      const fullPath = path.join(
        process.cwd(),
        "workspaces",
        login,
        localRelative,
      );

      const content = await fs.promises.readFile(fullPath, "utf8");
      return res.json({ content });
    }

    if (filePath.startsWith("local/")) {
      const localRelative = filePath
        .replace(/^local\//, "")
        .replace(/^docs\//, "");

      const fullPath = path.join(
        process.cwd(),
        "workspaces",
        login,
        localRelative,
      );

      const content = await fs.promises.readFile(fullPath, "utf8");
      return res.json({ content });
    }

    filePath = filePath.replace(/^Rotorflight-docs\//, "");
    const githubPath = filePath.replace(/^Rotorflight-docs\//, "");

    const result = await githubRequest(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubPath}?ref=${GITHUB_DEFAULT_BRANCH}`,
    );

    const content = Buffer.from(result.content, "base64").toString("utf8");
    return res.json({ content });
  } catch (err) {
    console.error("❌ LOAD ERROR:", err);
    return res.status(500).json({ error: "Failed to load document" });
  }
});

// ---------------------------------------------
// CLONE GITHUB FILE TO LOCAL WORKSPACE
// ---------------------------------------------
router.post("/clone-to-local", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { token, login } = auth;
  const { path: filePath } = req.body;

  try {
    const githubPath = filePath.replace(/^Rotorflight-docs\//, "");

    const result = await githubRequest(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubPath}?ref=${GITHUB_DEFAULT_BRANCH}`,
    );

    const content = Buffer.from(result.content, "base64").toString("utf8");

    const clean = filePath.replace(/^Rotorflight-docs\//, "");
    const workspaceRoot = path.join(process.cwd(), "workspaces", login);
    const localPath = path.join(workspaceRoot, clean);

    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await fs.promises.writeFile(localPath, content, "utf8");

    const referenced = extractImagePaths(content);

    const resolvedDocsPaths = referenced.map((rel) =>
      resolveDocsPath(filePath, rel),
    );

    for (const absDocsPath of resolvedDocsPaths) {
      try {
        const githubImgPath = absDocsPath.replace(/^Rotorflight-docs\//, "");

        const imgRes = await githubRequest(
          token,
          `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubImgPath}?ref=${GITHUB_DEFAULT_BRANCH}`,
        );

        const imgData = Buffer.from(imgRes.content, "base64");

        const localImgPath = path.join(
          workspaceRoot,
          absDocsPath.replace(/^Rotorflight-docs\//, ""),
        );

        await fs.promises.mkdir(path.dirname(localImgPath), {
          recursive: true,
        });
        await fs.promises.writeFile(localImgPath, imgData);
      } catch (err) {
        console.warn("⚠️ Failed to copy referenced image:", absDocsPath);
      }
    }

    return res.json({
      localPath: `local-workspace/${clean}`,
    });
  } catch (err) {
    console.error("❌ clone-to-local error:", err);
    res.status(500).json({ error: "Failed to clone file locally" });
  }
});

// ---------------------------------------------
// SERVE IMAGES
// ---------------------------------------------
router.get("/image", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { token } = auth;
  let imgPath = req.query.path as string;

  imgPath = imgPath.replace(/\\/g, "/");
  imgPath = imgPath.replace(/^Rotorflight-docs\//, "");

  try {
    const result = await githubRequest(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${imgPath}?ref=${GITHUB_DEFAULT_BRANCH}`,
    );

    const data = Buffer.from(result.content, "base64");

    const ext = path.extname(imgPath).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".gif"
            ? "image/gif"
            : ext === ".svg"
              ? "image/svg+xml"
              : ext === ".webp"
                ? "image/webp"
                : "application/octet-stream";

    res.setHeader("Content-Type", mime);
    return res.send(data);
  } catch (err) {
    console.error("❌ GitHub image error:", err);
    return res.status(404).end();
  }
});

// LOCAL IMAGES
router.get("/images/local", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login } = auth;
  let imgPath = req.query.path as string;

  imgPath = imgPath.replace(/\\/g, "/");

  const fullPath = path.join(process.cwd(), "workspaces", login, imgPath);

  try {
    return res.sendFile(fullPath);
  } catch {
    return res.status(404).end();
  }
});

// ---------------------------------------------
// SAVE DOCUMENT LOCALLY
// ---------------------------------------------
router.post("/save", async (req, res) => {
  console.log(
    "SAVE ROUTE HIT",
    req.body,
    new Date().getMinutes(),
    ":",
    new Date().getSeconds(),
  );

  const auth = requireToken(req, res);
  if (!auth) return;

  const { login } = auth;
  const { path: filePath, content } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: "Missing file path" });
  }
  if (typeof content !== "string") {
    return res.status(400).json({ error: "Invalid file content" });
  }

  try {
    const fullPath = path.join(process.cwd(), "workspaces", login, filePath);

    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, content, "utf8");

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Failed to save file:", err);
    res.status(500).json({ error: "Failed to save file" });
  }
});

// ---------------------------------------------
// GET CURRENT GITHUB COMMIT HASH
// ---------------------------------------------
router.get("/github-hash", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { token } = auth;

  try {
    const commit = await githubRequest(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits/${GITHUB_DEFAULT_BRANCH}`,
    );

    return res.json({ hash: commit.sha });
  } catch (err) {
    console.error("❌ Failed to fetch GitHub hash:", err);
    return res.status(500).json({ error: "Failed to fetch GitHub hash" });
  }
});

// ---------------------------------------------
// Reset local workspace (delete all files)
// ---------------------------------------------
router.post("/reset-local", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login, token } = auth;

  try {
    const workspaceRoot = path.join(process.cwd(), "workspaces", login);
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true });

    const cacheRoot = path.join(process.cwd(), "cache");
    await fs.promises.rm(cacheRoot, { recursive: true, force: true });

    await fs.promises.mkdir(workspaceRoot, { recursive: true });

    const tree = await githubRequest(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${GITHUB_DEFAULT_BRANCH}?recursive=1`,
    );

    for (const item of tree.tree) {
      if (item.type !== "tree") continue;

      if (
        !item.path.startsWith("docs/") &&
        !item.path.startsWith("versioned_docs/")
      ) {
        continue;
      }

      const localPath = path.join(workspaceRoot, item.path);
      await fs.promises.mkdir(localPath, { recursive: true });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ reset-local error:", err);
    res.status(500).json({ error: "Failed to reset local workspace" });
  }
});

export default router;
