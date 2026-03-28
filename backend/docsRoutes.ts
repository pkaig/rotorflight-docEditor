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
// Helper
// ---------------------------------------------
async function walkDir(root: string, base = "") {
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const rel = path.join(base, entry.name);
    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      const sub = await walkDir(full, rel);
      files.push(...sub);
    } else {
      files.push(rel.replace(/\\/g, "/"));
    }
  }

  return files;
}

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
    type: "dir" as const,
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
          type: "file" as const,
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
  const workspace = (req.query.workspace as string) || req.body?.workspace;

  if (!login) {
    res.status(401).json({ error: "Missing login" });
    return null;
  }

  if (!workspace) {
    res.status(400).json({ error: "Missing workspace" });
    return null;
  }

  try {
    const token = getTokenForUser(login);

    const userRoot = path.join(process.cwd(), "workspaces", login);
    fs.mkdirSync(userRoot, { recursive: true });

    const workspaceRoot = path.join(userRoot, workspace);
    fs.mkdirSync(workspaceRoot, { recursive: true });

    return { token, login, workspace };
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
// Local recursive walker (flat list for diffing)
// ---------------------------------------------
async function walkLocalTree(rootPath: string): Promise<string[]> {
  async function walk(dir: string, base: string): Promise<string[]> {
    let results: string[] = [];

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      console.error("❌ walkLocalTree failed:", dir, err);
      return results;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.join(base, entry.name).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        const sub = await walk(full, rel);
        results.push(...sub);
        continue;
      }

      if (entry.isFile()) {
        const isDoc = entry.name.endsWith(".md") || entry.name.endsWith(".mdx");
        const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(entry.name);

        if (isDoc || isImage) {
          results.push(rel);
        }
      }
    }

    return results;
  }

  return walk(rootPath, "");
}

// ---------------------------------------------
// Walk the local workspace
// ---------------------------------------------
async function walkLocalWorkspaceTree(
  rootPath: string,
  prefix: string,
): Promise<TreeNode> {
  const name = path.basename(rootPath);
  const node: TreeNode = {
    type: "dir",
    name,
    path: prefix,
    children: [],
  };

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(rootPath, { withFileTypes: true });
  } catch (err) {
    console.warn("⚠️ walkLocalWorkspaceTree failed:", rootPath, err);
    return node;
  }

  for (const entry of entries) {
    const full = path.join(rootPath, entry.name);
    const relPath = `${prefix}/${entry.name}`;

    if (entry.isDirectory()) {
      const child = await walkLocalWorkspaceTree(full, relPath);
      node.children!.push(child);
      continue;
    }

    if (entry.isFile()) {
      const isDoc = entry.name.endsWith(".md") || entry.name.endsWith(".mdx");
      const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(entry.name);

      if (isDoc || isImage) {
        node.children!.push({
          type: "file",
          name: entry.name,
          path: relPath,
        });
      }
    }
  }

  return node;
}

// ---------------------------------------------
// Build workspace tree (docs + versioned_docs)
// ---------------------------------------------
async function buildLocalWorkspace(login: string, workspace: string) {
  const workspaceRoot = path.join(
    process.cwd(),
    "workspaces",
    login,
    workspace,
  );

  const docsRoot = path.join(workspaceRoot, "docs");
  const versionedRoot = path.join(workspaceRoot, "versioned_docs");

  await fs.promises.mkdir(docsRoot, { recursive: true });
  await fs.promises.mkdir(versionedRoot, { recursive: true });

  const children: TreeNode[] = [];

  try {
    const docsTree = await walkLocalWorkspaceTree(
      docsRoot,
      `local-workspace/${workspace}/docs`,
    );
    children.push(docsTree);
  } catch {
    console.warn("No local docs folder:", docsRoot);
  }

  try {
    const versionedTree = await walkLocalWorkspaceTree(
      versionedRoot,
      `local-workspace/${workspace}/versioned_docs`,
    );
    children.push(versionedTree);
  } catch {
    console.warn("No local versioned_docs folder:", versionedRoot);
  }

  return {
    type: "dir",
    name: workspace,
    path: `local-workspace/${workspace}`,
    children,
    isWorkspaceRoot: true,
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

  const { login, workspace } = auth;

  try {
    const localTree = await buildLocalWorkspace(login, workspace);
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

  const { login, workspace } = auth;
  const { folder } = req.body;
  const file = req.file;

  if (!folder || !file) {
    return res.status(400).json({ error: "Missing folder or file" });
  }

  const workspaceRoot = path.join(
    process.cwd(),
    "workspaces",
    login,
    workspace,
  );
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

  const { token, login, workspace } = auth;
  let filePath = req.query.path as string;

  filePath = filePath.replace(/\\/g, "/");

  try {
    // NEW: local workspace files (docs + versioned_docs)
    if (
      filePath.startsWith("docs/") ||
      filePath.startsWith("versioned_docs/")
    ) {
      const fullPath = path.join(
        process.cwd(),
        "workspaces",
        login,
        workspace,
        filePath,
      );

      const content = await fs.promises.readFile(fullPath, "utf8");
      return res.json({ content });
    }

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
        workspace,
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
        workspace,
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

  const { token, login, workspace } = auth;
  const { path: filePath } = req.body;

  try {
    const githubPath = filePath.replace(/^Rotorflight-docs\//, "");

    const result = await githubRequest(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubPath}?ref=${GITHUB_DEFAULT_BRANCH}`,
    );

    const content = Buffer.from(result.content, "base64").toString("utf8");

    const clean = filePath.replace(/^Rotorflight-docs\//, "");
    const workspaceRoot = path.join(
      process.cwd(),
      "workspaces",
      login,
      workspace,
    );
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
// RESTORE A SINGLE FILE FROM GITHUB TO LOCAL
// ---------------------------------------------
router.post("/restore-file", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { token, login, workspace } = auth;
  const { path: filePath } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: "Missing file path" });
  }

  try {
    const githubPath = filePath.replace(/^Rotorflight-docs\//, "");

    const result = await githubRequest(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubPath}?ref=${GITHUB_DEFAULT_BRANCH}`,
    );

    const content = Buffer.from(result.content, "base64").toString("utf8");

    const workspaceRoot = path.join(
      process.cwd(),
      "workspaces",
      login,
      workspace,
    );
    const localPath = path.join(workspaceRoot, githubPath);

    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await fs.promises.writeFile(localPath, content, "utf8");

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ restore-file error:", err);
    return res.status(500).json({ error: "Failed to restore file" });
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

  const { login, workspace } = auth;
  let imgPath = req.query.path as string;

  imgPath = imgPath.replace(/\\/g, "/");

  // NEW: support workspace-relative paths
  let cleanImg = imgPath;

  // Strip legacy prefix if present
  cleanImg = cleanImg.replace(/^local-workspace\/[^/]+\//, "");

  // Now cleanImg is like:
  //   docs/img/foo.png
  //   versioned_docs/v1.0/img/bar.jpg

  const fullPath = path.join(
    process.cwd(),
    "workspaces",
    login,
    workspace,
    cleanImg,
  );

  try {
    return res.sendFile(fullPath);
  } catch {
    return res.status(404).end();
  }
});

// ---------------------------------------------
// SAVE DOCUMENT LOCALLY (content-aware)
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

  const { login, workspace } = auth;
  const { path: filePath, content } = req.body;

  if (!filePath.startsWith("local-workspace/")) {
    return res.status(400).json({ error: "Invalid save path" });
  }

  if (!filePath) {
    return res.status(400).json({ error: "Missing file path" });
  }
  if (typeof content !== "string") {
    return res.status(400).json({ error: "Invalid file content" });
  }

  try {
    const cleanPath = filePath.replace(/^local-workspace\//, "");

    const fullPath = path.join(
      process.cwd(),
      "workspaces",
      login,
      workspace,
      cleanPath,
    );

    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });

    let existing = null;
    try {
      existing = await fs.promises.readFile(fullPath, "utf8");
    } catch {
      // File does not exist yet
    }

    if (existing === content) {
      return res.json({ ok: true, unchanged: true });
    }

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
// Reset local workspace (with mirror population)
// ---------------------------------------------
router.post("/reset-local", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login, token, workspace } = auth;

  try {
    const workspaceRoot = path.join(
      process.cwd(),
      "workspaces",
      login,
      workspace,
    );
    const mirrorRoot = path.join(process.cwd(), "workspaces", login, "mirror");

    await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
    await fs.promises.mkdir(workspaceRoot, { recursive: true });

    const cacheRoot = path.join(process.cwd(), "cache");
    await fs.promises.rm(cacheRoot, { recursive: true, force: true });

    await fs.promises.mkdir(mirrorRoot, { recursive: true });

    const tree = await githubRequest(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${GITHUB_DEFAULT_BRANCH}?recursive=1`,
    );

    if (!tree || !Array.isArray(tree.tree)) {
      console.error("❌ reset-local: invalid GitHub tree:", tree);
      return res.status(500).json({ error: "Invalid GitHub tree" });
    }

    for (const item of tree.tree) {
      if (item.type !== "blob") continue;

      if (
        !item.path.startsWith("docs/") &&
        !item.path.startsWith("versioned_docs/")
      ) {
        continue;
      }

      const mirrorPath = path.join(mirrorRoot, item.path);
      await fs.promises.mkdir(path.dirname(mirrorPath), { recursive: true });

      const file = await githubRequest(
        token,
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${item.path}?ref=${GITHUB_DEFAULT_BRANCH}`,
      );

      const content = Buffer.from(file.content, "base64").toString("utf8");
      await fs.promises.writeFile(mirrorPath, content, "utf8");

      const localPath = path.join(workspaceRoot, item.path);
      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
      await fs.promises.writeFile(localPath, content, "utf8");
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ reset-local error:", err);
    res.status(500).json({ error: "Failed to reset local workspace" });
  }
});

// ---------------------------------------------
// SCAN LOCAL CHANGES (mirror diff)
// ---------------------------------------------
router.get("/scan-local-changes", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login, workspace } = auth;

  const workspaceRoot = path.join(
    process.cwd(),
    "workspaces",
    login,
    workspace,
  );
  const mirrorRoot = path.join(process.cwd(), "workspaces", login, "mirror");

  try {
    const localFiles = await walkLocalTree(workspaceRoot);
    const mirrorFiles = await walkLocalTree(mirrorRoot);

    const added: any[] = [];
    const modified: any[] = [];
    const deleted: any[] = [];
    const renamed: any[] = [];

    const filterDocs = (f: string) =>
      f.startsWith("docs/") || f.startsWith("versioned_docs/");

    const localSet = new Set(localFiles.filter(filterDocs));
    const mirrorSet = new Set(mirrorFiles.filter(filterDocs));

    for (const file of localSet) {
      if (!mirrorSet.has(file)) {
        added.push({ path: file, type: "added" });
        continue;
      }

      const localPath = path.join(workspaceRoot, file);
      const mirrorPath = path.join(mirrorRoot, file);

      const localContent = await fs.promises.readFile(localPath, "utf8");
      const mirrorContent = await fs.promises.readFile(mirrorPath, "utf8");

      if (localContent !== mirrorContent) {
        modified.push({ path: file, type: "modified" });
      }
    }

    for (const file of mirrorSet) {
      if (!localSet.has(file)) {
        deleted.push({ path: file, type: "deleted" });
      }
    }

    res.json({ added, modified, deleted, renamed });
  } catch (err) {
    console.error("❌ scan-local-changes error:", err);
    res.status(500).json({ error: "Failed to scan local changes" });
  }
});

// ---------------------------------------------
// CREATE NEW WORKSPACE
// ---------------------------------------------
router.post("/create-workspace", async (req, res) => {
  const login = req.query.login as string;
  const workspace = req.body.workspace as string;

  if (!login) {
    return res.status(401).json({ error: "Missing login" });
  }

  if (!workspace || typeof workspace !== "string") {
    return res.status(400).json({ error: "Missing or invalid workspace name" });
  }

  // Validate workspace name: short, safe, no spaces
  if (!/^[a-zA-Z0-9-_]+$/.test(workspace)) {
    return res.status(400).json({
      error:
        "Invalid workspace name. Use only letters, numbers, hyphens, and underscores.",
    });
  }

  try {
    const token = getTokenForUser(login);

    const userRoot = path.join(process.cwd(), "workspaces", login);
    const mirrorRoot = path.join(userRoot, "mirror");
    const workspaceRoot = path.join(userRoot, workspace);

    // Ensure user root exists
    await fs.promises.mkdir(userRoot, { recursive: true });

    // Ensure mirror exists — if not, build it
    const mirrorExists = fs.existsSync(mirrorRoot);

    if (!mirrorExists) {
      console.log("⚠️ Mirror missing — building fresh mirror for user:", login);

      await fs.promises.mkdir(mirrorRoot, { recursive: true });

      const tree = await githubRequest(
        token,
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${GITHUB_DEFAULT_BRANCH}?recursive=1`,
      );

      if (!tree || !Array.isArray(tree.tree)) {
        return res.status(500).json({ error: "Failed to build mirror" });
      }

      for (const item of tree.tree) {
        if (item.type !== "blob") continue;
        if (
          !item.path.startsWith("docs/") &&
          !item.path.startsWith("versioned_docs/")
        ) {
          continue;
        }

        const mirrorPath = path.join(mirrorRoot, item.path);
        await fs.promises.mkdir(path.dirname(mirrorPath), { recursive: true });

        const file = await githubRequest(
          token,
          `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${item.path}?ref=${GITHUB_DEFAULT_BRANCH}`,
        );

        const content = Buffer.from(file.content, "base64").toString("utf8");
        await fs.promises.writeFile(mirrorPath, content, "utf8");
      }
    }

    // Create workspace folder
    await fs.promises.mkdir(workspaceRoot, { recursive: true });

    // Copy mirror → workspace/docs + workspace/versioned_docs
    const mirrorDocs = path.join(mirrorRoot, "docs");
    const mirrorVersioned = path.join(mirrorRoot, "versioned_docs");

    const wsDocs = path.join(workspaceRoot, "docs");
    const wsVersioned = path.join(workspaceRoot, "versioned_docs");

    await fs.promises.mkdir(wsDocs, { recursive: true });
    await fs.promises.mkdir(wsVersioned, { recursive: true });

    // Helper to copy recursively
    async function copyRecursive(src: string, dest: string) {
      if (!fs.existsSync(src)) return;

      const entries = await fs.promises.readdir(src, { withFileTypes: true });

      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          await fs.promises.mkdir(destPath, { recursive: true });
          await copyRecursive(srcPath, destPath);
        } else {
          const content = await fs.promises.readFile(srcPath);
          await fs.promises.writeFile(destPath, content);
        }
      }
    }

    await copyRecursive(mirrorDocs, wsDocs);
    await copyRecursive(mirrorVersioned, wsVersioned);

    return res.json({
      ok: true,
      workspace,
      path: `local-workspace/${workspace}`,
    });
  } catch (err) {
    console.error("❌ create-workspace error:", err);
    return res.status(500).json({ error: "Failed to create workspace" });
  }
});

// WORKSPACE LISTING (for dropdowns, etc.)
router.get("/list-workspaces", async (req, res) => {
  const login = req.query.login;
  if (!login) {
    return res.status(400).json({ error: "Missing login" });
  }

  const base = path.join(process.cwd(), "workspaces", login);

  // Ensure the directory exists
  await fs.promises.mkdir(base, { recursive: true });

  try {
    const entries = await fs.promises.readdir(base, { withFileTypes: true });

    const workspaces = entries
      .filter((e) => e.isDirectory() && e.name !== "mirror")
      .map((e) => e.name);

    res.json({ workspaces });
  } catch (err) {
    console.error("Failed to list workspaces", err);
    res.status(500).json({ error: "Failed to list workspaces" });
  }
});

router.get("/list-user-workspaces", async (req, res) => {
  try {
    const login = req.query.login;
    if (!login) {
      return res.status(400).json({ error: "Missing login" });
    }

    const base = path.join(process.cwd(), "workspaces", login);

    let entries = [];
    try {
      entries = await fs.promises.readdir(base, { withFileTypes: true });
    } catch (err) {
      // Folder doesn't exist → return empty list instead of 500
      return res.json({ workspaces: [] });
    }

    const workspaces = entries
      .filter((e) => e.isDirectory() && e.name !== "mirror")
      .map((e) => e.name);

    return res.json({ workspaces });
  } catch (err) {
    console.error("list-user-workspaces failed:", err);
    return res.json({ workspaces: [] });
  }
});

router.delete("/delete-workspace", async (req, res) => {
  const { login, workspace } = req.query;

  console.log("Delete workspace request:", login, workspace);

  if (!login || !workspace) {
    return res.status(400).json({ error: "Missing login or workspace" });
  }

  // Build the correct path
  const base = path.join(process.cwd(), "workspaces", login);
  const wsPath = path.join(base, workspace);

  try {
    await fs.promises.rm(wsPath, { recursive: true, force: true });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Delete workspace error:", err);
    return res.status(500).json({ error: "Failed to delete workspace" });
  }
});

export default router;
