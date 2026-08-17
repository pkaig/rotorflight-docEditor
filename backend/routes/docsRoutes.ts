import express from "express";
import { githubRequest } from "../githubClient";
import { getTokenForUser } from "./authRoutes";
import { ensureMirrorUpToDate } from "./resetMirror";
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_DEFAULT_BRANCH,
} from "../config/github";
import path from "path";
import * as fs from "fs-extra";
import multer from "multer";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Root-level file (sibling of docs/, versioned_docs/) holding cspell's
// custom project dictionary. Tracked specially so spell-checker additions
// can flow through the same scan/commit/PR pipeline as doc edits.
const PROJECT_WORDS_FILE = "project-words.txt";

/* ============================================================
   1. AUTH + WORKSPACE ROOT
   ============================================================ */

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

/* ============================================================
   2. LOCAL TREE WALKER (FLAT LIST FOR DIFFING)
   ============================================================ */

async function walkLocalTree(rootPath: string): Promise<string[]> {
  async function walk(dir: string, base: string): Promise<string[]> {
    let results: string[] = [];

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.join(base, entry.name).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        results.push(...(await walk(full, rel)));
        continue;
      }

      if (entry.isFile()) {
        const isDoc = entry.name.endsWith(".md") || entry.name.endsWith(".mdx");
        const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(entry.name);
        const isProjectWords = rel === PROJECT_WORDS_FILE;
        if (isDoc || isImage || isProjectWords) results.push(rel);
      }
    }

    return results;
  }

  return walk(rootPath, "");
}

/* ============================================================
   3. LOCAL WORKSPACE TREE (SIDEBAR)
   ============================================================ */

async function walkLocalWorkspaceTree(rootPath: string, prefix: string) {
  const node = {
    type: "dir",
    name: path.basename(rootPath),
    path: prefix,
    children: [],
  };

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(rootPath, { withFileTypes: true });
  } catch {
    return node;
  }

  for (const entry of entries) {
    const full = path.join(rootPath, entry.name);
    const rel = `${prefix}/${entry.name}`;

    if (entry.isDirectory()) {
      node.children.push(await walkLocalWorkspaceTree(full, rel));
      continue;
    }

    if (entry.isFile()) {
      const isDoc = entry.name.endsWith(".md") || entry.name.endsWith(".mdx");
      const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(entry.name);
      if (isDoc || isImage) {
        node.children.push({
          type: "file",
          name: entry.name,
          path: rel,
        });
      }
    }
  }

  return node;
}

async function buildLocalWorkspace(login: string, workspace: string) {
  const workspaceRoot = path.join(
    process.cwd(),
    "workspaces",
    login,
    workspace,
  );

  const docsRoot = path.join(workspaceRoot, "docs");
  const versionedRoot = path.join(workspaceRoot, "versioned_docs");

  await fs.ensureDir(docsRoot);
  await fs.ensureDir(versionedRoot);

  return {
    type: "dir",
    name: workspace,
    path: `local-workspace/${workspace}`,
    children: [
      await walkLocalWorkspaceTree(
        docsRoot,
        `local-workspace/${workspace}/docs`,
      ),
      await walkLocalWorkspaceTree(
        versionedRoot,
        `local-workspace/${workspace}/versioned_docs`,
      ),
    ],
  };
}

/* ============================================================
   4. LIST LOCAL WORKSPACE (SIDEBAR)
   ============================================================ */

router.get("/list-local", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login, workspace } = auth;

  try {
    const tree = await buildLocalWorkspace(login, workspace);
    return res.json({ docs: [tree] });
  } catch (err) {
    return res.status(500).json({ error: "Failed to list local workspace" });
  }
});

/* ============================================================
   5. LOCAL UPLOAD (IMAGES / ASSETS)
   ============================================================ */

router.post("/local/upload", upload.single("file"), async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login, workspace } = auth;
  const { folder } = req.body;
  const file = req.file;

  if (!folder || !file) {
    return res.status(400).json({ error: "Missing folder or file" });
  }

  const dest = path.join(
    process.cwd(),
    "workspaces",
    login,
    workspace,
    folder,
    file.originalname,
  );

  await fs.ensureDir(path.dirname(dest));
  await fs.writeFile(dest, file.buffer);

  res.json({ ok: true, path: `${folder}/${file.originalname}` });
});

/* ============================================================
   6. LOAD DOCUMENT (LOCAL ONLY)
   ============================================================ */

router.get("/load", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login, workspace } = auth;
  let filePath = req.query.path as string;

  filePath = filePath.replace(/\\/g, "/");

  try {
    // Strip canonical prefix
    if (filePath.startsWith("local-workspace/")) {
      const [, ws, ...rest] = filePath.split("/");
      filePath = rest.join("/");
    }

    const fullPath = path.join(
      process.cwd(),
      "workspaces",
      login,
      workspace,
      filePath,
    );

    const content = await fs.readFile(fullPath, "utf8");
    return res.json({ content });
  } catch {
    return res.status(500).json({ error: "Failed to load document" });
  }
});

/* ============================================================
   7. RESTORE FILE FROM MIRROR
   ============================================================ */

router.post("/restore-file", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login, workspace } = auth;
  const { path: filePath } = req.body;

  try {
    const clean = filePath.replace(/^local-workspace\/[^/]+\//, "");

    const workspaceRoot = path.join(
      process.cwd(),
      "workspaces",
      login,
      workspace,
    );
    const mirrorPath = path.join(workspaceRoot, "mirror", clean);
    const localPath = path.join(workspaceRoot, clean);

    const content = await fs.readFile(mirrorPath, "utf8");

    await fs.ensureDir(path.dirname(localPath));
    await fs.writeFile(localPath, content, "utf8");

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Failed to restore file" });
  }
});

/* ============================================================
   8. SERVE LOCAL IMAGES
   ============================================================ */

// Also doubles as a generic "read any workspace file" endpoint — used by
// the preview's MDX import resolver for CSS/JSON/component source text as
// well as images (see frontend/src/mdx/fetchWorkspaceFile.ts).
router.get("/images/local", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login } = auth;
  let imgPath = req.query.path as string;

  imgPath = imgPath.replace(/\\/g, "/");

  const parts = imgPath.split("/");
  const ws = parts[1];
  const clean = parts.slice(2).join("/");

  // Workspaces only ever sync docs/ and versioned_docs/ (the user-editable
  // surface) — everything else a doc can reference via the `@site/` alias
  // (e.g. `@site/src/components/...`) lives only in the shared upstream
  // mirror, never copied per-workspace since users don't edit it here.
  const isWorkspaceLocal =
    clean === "docs" ||
    clean.startsWith("docs/") ||
    clean === "versioned_docs" ||
    clean.startsWith("versioned_docs/");

  const fullPath = isWorkspaceLocal
    ? path.join(process.cwd(), "workspaces", login, ws, clean)
    : path.join(process.cwd(), "Rotorflight-docs", "mirror", clean);

  try {
    return res.sendFile(fullPath);
  } catch {
    return res.status(404).end();
  }
});

/* ============================================================
   9. SAVE DOCUMENT
   ============================================================ */

router.post("/save", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login, workspace } = auth;
  let { path: filePath, content } = req.body;

  try {
    filePath = filePath.replace(/\\/g, "/");

    if (filePath.startsWith("local-workspace/")) {
      const [, ws, ...rest] = filePath.split("/");
      filePath = rest.join("/");
    }

    const fullPath = path.join(
      process.cwd(),
      "workspaces",
      login,
      workspace,
      filePath,
    );

    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, "utf8");

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Failed to save document" });
  }
});

/* ============================================================
   10. RESET LOCAL WORKSPACE (REBUILD FROM GLOBAL MIRROR)
   ============================================================ */

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
    const mirrorRoot = path.join(
      process.cwd(),
      "Rotorflight-docs",
      login,
      "mirror",
    );

    await fs.remove(workspaceRoot);
    await fs.ensureDir(workspaceRoot);
    await fs.ensureDir(mirrorRoot);

    const tree = await githubRequest(
      token,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${GITHUB_DEFAULT_BRANCH}?recursive=1`,
    );

    for (const item of tree.tree) {
      if (item.type !== "blob") continue;
      if (
        !item.path.startsWith("docs/") &&
        !item.path.startsWith("versioned_docs/")
      )
        continue;

      const file = await githubRequest(
        token,
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${item.path}?ref=${GITHUB_DEFAULT_BRANCH}`,
      );

      const content = Buffer.from(file.content, "base64").toString("utf8");

      const mirrorPath = path.join(mirrorRoot, item.path);
      const localPath = path.join(workspaceRoot, item.path);

      await fs.ensureDir(path.dirname(mirrorPath));
      await fs.ensureDir(path.dirname(localPath));

      await fs.writeFile(mirrorPath, content, "utf8");
      await fs.writeFile(localPath, content, "utf8");
    }

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Failed to reset workspace" });
  }
});

/* ============================================================
   11. SCAN LOCAL CHANGES (MIRROR DIFF)
   ============================================================ */

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
  const mirrorRoot = path.join(workspaceRoot, "mirror");

  try {
    const localFiles = await walkLocalTree(workspaceRoot);
    const mirrorFiles = await walkLocalTree(mirrorRoot);

    const added = [];
    const modified = [];
    const deleted = [];

    const filterDocs = (f: string) =>
      f.startsWith("docs/") ||
      f.startsWith("versioned_docs/") ||
      f === PROJECT_WORDS_FILE;

    const localSet = new Set(localFiles.filter(filterDocs));
    const mirrorSet = new Set(mirrorFiles.filter(filterDocs));

    for (const file of localSet) {
      if (!mirrorSet.has(file)) {
        added.push({ path: file, type: "added" });
        continue;
      }

      const localPath = path.join(workspaceRoot, file);
      const mirrorPath = path.join(mirrorRoot, file);

      const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(file);

      if (isImage) {
        const localStat = await fs.stat(localPath);
        const mirrorStat = await fs.stat(mirrorPath);

        if (
          localStat.size !== mirrorStat.size ||
          localStat.mtimeMs !== mirrorStat.mtimeMs
        ) {
          modified.push({ path: file, type: "modified" });
        }

        continue;
      }

      const localContent = await fs.readFile(localPath, "utf8");
      const mirrorContent = await fs.readFile(mirrorPath, "utf8");

      if (localContent !== mirrorContent) {
        modified.push({ path: file, type: "modified" });
      }
    }

    for (const file of mirrorSet) {
      if (!localSet.has(file)) {
        // project-words.txt's editable local copy only gets created
        // lazily, the first time a word is actually added via the
        // spell-checker's "add to dictionary" action (see
        // POST /project-words/add). Its absence here just means nothing's
        // been added yet in this workspace — not that the user deleted
        // the project's shared dictionary file, which this was otherwise
        // reporting as a real deletion in every PR.
        if (file === PROJECT_WORDS_FILE) continue;
        deleted.push({ path: file, type: "deleted" });
      }
    }

    return res.json({ added, modified, deleted, renamed: [] });
  } catch {
    return res.status(500).json({ error: "Failed to scan local changes" });
  }
});

/* ============================================================
   12. CREATE WORKSPACE (COPY FROM GLOBAL MIRROR)
   ============================================================ */

router.post("/create-workspace", async (req, res) => {
  const login = req.query.login as string;
  const workspace = req.body.workspace as string;

  try {
    const token = getTokenForUser(login);

    // 1. Ensure global mirror is current
    await ensureMirrorUpToDate(token);

    // 2. Create workspace root
    const workspaceRoot = path.join(
      process.cwd(),
      "workspaces",
      login,
      workspace,
    );
    await fs.ensureDir(workspaceRoot);

    // 3. Load workspace mirror (baseline)
    const loadRes = await fetch(
      `http://localhost:${process.env.PORT || 4000}/api/reset-mirror/load-workspace-mirror?login=${encodeURIComponent(
        login,
      )}&workspace=${encodeURIComponent(workspace)}`,
      { method: "POST" },
    );

    const loadJson = await loadRes.json();
    if (!loadJson.ok) {
      return res.status(500).json({
        error: "Failed to load workspace mirror",
        details: loadJson,
      });
    }

    // 4. Copy docs + versioned_docs into editable workspace
    const globalMirror = path.join(process.cwd(), "Rotorflight-docs", "mirror");
    const workspaceDocs = path.join(workspaceRoot, "docs");
    const workspaceVersioned = path.join(workspaceRoot, "versioned_docs");

    await fs.copy(path.join(globalMirror, "docs"), workspaceDocs);
    await fs.copy(
      path.join(globalMirror, "versioned_docs"),
      workspaceVersioned,
    );

    // 5. Store upstream hash
    const upstreamSha = await fs.readFile(
      path.join(globalMirror, ".upstream-hash"),
      "utf8",
    );

    await fs.writeFile(
      path.join(workspaceRoot, "mirror-hash.txt"),
      upstreamSha,
    );

    return res.json({ ok: true, workspace });
  } catch (err) {
    console.error("Failed to create workspace:", err);
    return res.status(500).json({ error: "Failed to create workspace" });
  }
});

/* ============================================================
   13. SUBMIT PR (CREATE OR UPDATE)
   ============================================================ */

router.post("/submit-pr", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login, workspace } = auth;
  const { description } = req.body;

  try {
    const scan = await fetch(
      `http://localhost:4000/api/docs/scan-local-changes?login=${encodeURIComponent(
        login,
      )}&workspace=${encodeURIComponent(workspace)}`,
    ).then((r) => r.json());

    const commitRes = await fetch(
      `http://localhost:4000/api/git/commit?login=${encodeURIComponent(
        login,
      )}&workspace=${encodeURIComponent(workspace)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: scan }),
      },
    );

    // Previously ignored: a failed commit (e.g. GitHub API/auth error)
    // still fell through to attempting a PR, either against stale content
    // or failing later with no clear signal of what actually went wrong.
    if (!commitRes.ok) {
      const commitErr = await commitRes.json().catch(() => ({}));
      console.error("submit-pr: commit step failed:", commitErr);
      return res.status(500).json({
        status: "error",
        error: commitErr.error || "Failed to commit changes",
      });
    }

    const prFetchRes = await fetch(
      `http://localhost:4000/api/git/pr?login=${encodeURIComponent(
        login,
      )}&workspace=${encodeURIComponent(workspace)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      },
    );

    const prRes = await prFetchRes.json();

    if (!prFetchRes.ok) {
      console.error("submit-pr: PR step failed:", prRes);
      return res.status(500).json({
        status: "error",
        error: prRes.error || "Failed to create/update PR",
      });
    }

    return res.json(prRes);
  } catch (err) {
    console.error("submit-pr failed:", err);
    return res.status(500).json({ status: "error", error: "Failed to submit PR" });
  }
});

/* ============================================================
   14. LIST USER WORKSPACES
   ============================================================ */

router.get("/list-user-workspaces", async (req, res) => {
  const login = req.query.login as string;

  if (!login) {
    return res.status(400).json({ error: "Missing login" });
  }

  try {
    const userRoot = path.join(process.cwd(), "workspaces", login);

    await fs.ensureDir(userRoot);

    const entries = await fs.readdir(userRoot, { withFileTypes: true });

    const workspaces = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    return res.json({ workspaces });
  } catch (err) {
    console.error("❌ list-user-workspaces error:", err);
    return res.status(500).json({ error: "Failed to list workspaces" });
  }
});

/* ============================================================
   15. DELETE USER WORKSPACES
   ============================================================ */
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

/* ============================================================
   16. CHECK UPSTREAM STATUS FOR CHANGES
   ============================================================ */
router.get("/workspace-upstream-status", async (req, res) => {
  const login = req.query.login as string;
  const workspace = req.query.workspace as string;

  if (!login || !workspace)
    return res.status(400).json({ error: "Missing login or workspace" });

  try {
    const token = getTokenForUser(login);

    const globalHash = await fs
      .readFile(
        path.join("Rotorflight-docs", "mirror", ".upstream-hash"),
        "utf8",
      )
      .then((s) => s.trim());

    const workspaceHashPath = path.join(
      "workspaces",
      login,
      workspace,
      "mirror-hash.txt",
    );

    if (!(await fs.pathExists(workspaceHashPath))) {
      return res.json({ stale: true, reason: "no-workspace-hash" });
    }

    const workspaceHash = await fs
      .readFile(workspaceHashPath, "utf8")
      .then((s) => s.trim());

    return res.json({
      stale: globalHash !== workspaceHash,
      globalHash,
      workspaceHash,
    });
  } catch (err) {
    console.error("workspace-upstream-status error:", err);
    return res.status(500).json({ error: "Failed to check workspace status" });
  }
});

/* ============================================================
   16. SPELL-CHECK PROJECT DICTIONARY (project-words.txt)
   ============================================================ */

function parseWordList(text: string): string[] {
  return text
    .split("\n")
    .map((w) => w.trim())
    .filter(Boolean);
}

// cspell.json carries its own small inline "words" allowlist (commit
// prefixes, tool names, etc.) separate from project-words.txt. It's the
// real repo's own config, so it's always read from the mirror baseline —
// there's no per-workspace editable copy of it to bootstrap.
async function readCspellInlineWords(workspaceRoot: string): Promise<string[]> {
  const cspellPath = path.join(workspaceRoot, "mirror", "cspell.json");

  if (!(await fs.pathExists(cspellPath))) return [];

  try {
    const config = JSON.parse(await fs.readFile(cspellPath, "utf8"));
    return Array.isArray(config.words) ? config.words : [];
  } catch (err) {
    console.error("Failed to parse cspell.json:", err);
    return [];
  }
}

// Effective word list: the workspace's own project-words.txt (or the
// baseline if no edits yet) merged with cspell.json's own inline words —
// both are sources the real project already treats as "not a typo".
router.get("/project-words", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login, workspace } = auth;
  const workspaceRoot = path.join(process.cwd(), "workspaces", login, workspace);
  const localPath = path.join(workspaceRoot, PROJECT_WORDS_FILE);
  const baselinePath = path.join(workspaceRoot, "mirror", PROJECT_WORDS_FILE);

  try {
    const source = (await fs.pathExists(localPath)) ? localPath : baselinePath;

    const fileWords = (await fs.pathExists(source))
      ? parseWordList(await fs.readFile(source, "utf8"))
      : [];
    const cspellWords = await readCspellInlineWords(workspaceRoot);

    const words = [...new Set([...fileWords, ...cspellWords])];
    return res.json({ words });
  } catch (err) {
    console.error("project-words error:", err);
    return res.status(500).json({ error: "Failed to read project word list" });
  }
});

router.post("/project-words/add", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login, workspace } = auth;
  const { word } = req.body;

  if (!word || typeof word !== "string" || !word.trim()) {
    return res.status(400).json({ error: "Missing word" });
  }

  const clean = word.trim();
  const workspaceRoot = path.join(process.cwd(), "workspaces", login, workspace);
  const localPath = path.join(workspaceRoot, PROJECT_WORDS_FILE);
  const baselinePath = path.join(workspaceRoot, "mirror", PROJECT_WORDS_FILE);

  try {
    // Bootstrap the editable copy from the workspace baseline the first
    // time a word is added here, same as docs/versioned_docs do on first edit.
    if (!(await fs.pathExists(localPath))) {
      if (await fs.pathExists(baselinePath)) {
        await fs.copy(baselinePath, localPath);
      } else {
        await fs.ensureDir(path.dirname(localPath));
        await fs.writeFile(localPath, "", "utf8");
      }
    }

    const words = parseWordList(await fs.readFile(localPath, "utf8"));

    // Append rather than re-sort: keeps the PR diff to a single added
    // line instead of reshuffling the whole existing list.
    if (!words.some((w) => w.toLowerCase() === clean.toLowerCase())) {
      words.push(clean);
      await fs.writeFile(localPath, words.join("\n") + "\n", "utf8");
    }

    return res.json({ words });
  } catch (err) {
    console.error("project-words/add error:", err);
    return res.status(500).json({ error: "Failed to add word" });
  }
});

export default router;
