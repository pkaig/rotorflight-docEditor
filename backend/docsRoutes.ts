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

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

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

  const results = new Set();
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
  }, []);

  return parts.join("/");
}

// ---------------------------------------------
// LIST DOCUMENTS (GitHub + Local Workspace)
// ---------------------------------------------
router.get("/list", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { token, login } = auth;

  // ---------------------------------------------
  // GitHub recursive walker
  // ---------------------------------------------
  async function walk(currentPath: string) {
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
      children: [],
    };

    for (const item of items) {
      if (item.type === "dir") {
        const child = await walk(item.path);
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
  // Local recursive walker (root = workspaces/<login>/)
  // ---------------------------------------------
  async function walkLocalWorkspace(rootPath: string) {
    async function walkDir(dir: string) {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      const relative = path
        .relative(rootPath, dir)
        .replace(/\\/g, "/")
        .replace(/^docs\//, "");

      const node = {
        type: "dir",
        name: path.basename(dir),
        path: `local-workspace/${relative}`,
        children: [],
      };

      for (const entry of entries) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          node.children.push(await walkDir(full));
          continue;
        }

        if (entry.isFile()) {
          const isDoc =
            entry.name.endsWith(".md") || entry.name.endsWith(".mdx");
          const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(entry.name);

          if (isDoc || isImage) {
            const relFile = path
              .relative(rootPath, full)
              .replace(/\\/g, "/")
              .replace(/^docs\//, "");

            node.children.push({
              type: "file",
              name: entry.name,
              path: `local-workspace/${relFile}`,
            });
          }
        }
      }

      return node;
    }

    return walkDir(rootPath);
  }

  // ---------------------------------------------
  // EXECUTE
  // ---------------------------------------------
  try {
    const tree = await walk("");
    const workspaceRoot = path.join(process.cwd(), "workspaces", login);

    let localTree = null;
    try {
      localTree = await walkLocalWorkspace(workspaceRoot);
    } catch {}

    const roots = [];

    // Wrap GitHub docs under Rotorflight-docs
    if (tree) {
      const allowed = ["docs", "versioned_docs"];

      roots.push({
        type: "dir",
        name: "Rotorflight-docs",
        path: "Rotorflight-docs",
        children: tree.children.filter((child) => allowed.includes(child.name)),
      });
    }

    // Local workspace
    if (localTree) {
      roots.push({
        type: "dir",
        name: "local-workspace",
        path: "local-workspace",
        children: localTree.children,
      });
    }

    res.json({ docs: roots });
  } catch (err) {
    console.error("❌ Failed to list docs:", err);
    res.status(500).json({ error: "Failed to list docs" });
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

  // folder example: "setup/img"
  const workspaceRoot = path.join(process.cwd(), "workspaces", login);
  const dest = path.join(workspaceRoot, folder, file.originalname);

  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest, file.buffer);

  res.json({
    ok: true,
    path: `${folder}/${file.originalname}`, // workspace-relative
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
    //
    // LOCAL FILE (new logic)
    //
    if (filePath.startsWith("local-workspace/")) {
      const localRelative = filePath
        .replace(/^local-workspace\//, "")
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

    //
    // OLD LOCAL PREFIX (still supported)
    //
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

    // GITHUB FILE
    filePath = filePath.replace(/^Rotorflight-docs\//, "");

    const githubPath = filePath.replace(/^Rotorflight-docs\//, "");
    console.log(
      "Loading GitHub file:",
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubPath}?ref=${GITHUB_DEFAULT_BRANCH}`,
    );
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
    //
    // 1. Fetch MDX file from GitHub
    //
    const githubPath = filePath.replace(/^Rotorflight-docs\//, "");

    const result = await githubRequest(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubPath}?ref=${GITHUB_DEFAULT_BRANCH}`,
    );

    // const githubPath = filePath.replace(/^Rotorflight-docs\//, "");
    // const result = await githubRequest(
    //   token,
    //   `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_DEFAULT_BRANCH}`,
    // );

    const content = Buffer.from(result.content, "base64").toString("utf8");
    console.log("Fetched file from GitHub:", filePath);
    //
    // 2. Write MDX file to workspace
    //
    const clean = filePath.replace(/^Rotorflight-docs\//, "");
    const workspaceRoot = path.join(process.cwd(), "workspaces", login);
    const localPath = path.join(workspaceRoot, clean);

    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await fs.promises.writeFile(localPath, content, "utf8");

    //
    // 3. Extract referenced image paths from MDX
    //
    const referenced = extractImagePaths(content);

    //
    // 4. Resolve each referenced path to an absolute docs path
    //
    const resolvedDocsPaths = referenced.map((rel) =>
      resolveDocsPath(filePath, rel),
    );

    //
    // 5. Copy each referenced image into the local workspace
    //
    for (const absDocsPath of resolvedDocsPaths) {
      try {
        // Fetch file from GitHub
        const githubImgPath = absDocsPath.replace(/^Rotorflight-docs\//, "");
        console.log(
          "Cloning imagese:",
          `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubImgPath}?ref=${GITHUB_DEFAULT_BRANCH}`,
        );
        const imgRes = await githubRequest(
          token,
          `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubImgPath}?ref=${GITHUB_DEFAULT_BRANCH}`,
        );

        const imgData = Buffer.from(imgRes.content, "base64");

        // Convert docs/... → local-workspace/...
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

    //
    // 6. Return correct local path
    //
    return res.json({
      localPath: `local-workspace/${clean}`,
      //localPath: `local/${clean}`,
    });
  } catch (err) {
    console.error("❌ clone-to-local error:", err);
    res.status(500).json({ error: "Failed to clone file locally" });
  }
});

// ---------------------------------------------
// SERVE IMAGES
// ---------------------------------------------
// GITHUB images
router.get("/image", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { token } = auth;
  let imgPath = req.query.path as string;

  imgPath = imgPath.replace(/\\/g, "/");

  // Strip Rotorflight-docs/ prefix
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

  // imgPath is already "docs/.../img/foo.png"
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
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login } = auth;
  const { path: filePath, content } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: "Missing file path" });
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

export default router;
