/* backend/routes/docsRoutes.ts
 *
 * Description of responsibility:
 *   The bulk of the per-workspace document API: listing a workspace's
 *   local file tree, loading/saving/creating doc files, uploading
 *   images, restoring a single file from the mirror baseline, scanning
 *   local changes against that baseline, creating/deleting workspaces,
 *   and submitting a workspace's changes as a PR. Also owns the
 *   per-workspace spell-check project dictionary (project-words.txt).
 *
 * Info:
 *   requireToken() is the shared guard nearly every route here starts
 *   with: it derives login from req.session (never a client-supplied
 *   query/body field) and validates the workspace name via
 *   isSafePathSegment() before it's ever joined into a filesystem path.
 *   scanLocalChanges() is exported as a plain function, not just used
 *   by its own route, so /submit-pr can call it directly in-process
 *   instead of over an HTTP self-call — a server-to-server fetch()
 *   doesn't carry the browser's session cookie, so those self-calls
 *   stopped working once every route required a session.
 */
import express, { type Request, type Response } from "express";
import {
  githubRequest,
  GitHubApiError,
  GitHubAppNotInstalledError,
  GitHubRateLimitError,
} from "../githubClient";
import { getTokenForUser } from "./authRoutes";
import { ensureMirrorUpToDate, loadWorkspaceMirror } from "./resetMirror";
import { commitChanges, submitPullRequest } from "./gitRoutes";
import { ForkError } from "../ensureFork";
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_DEFAULT_BRANCH,
  GITHUB_APP_INSTALL_URL,
} from "../config/github";

// Both commitChanges() and submitPullRequest() make several direct GitHub
// API calls beyond the two specific spots (fork creation, PR creation)
// that already throw GitHubAppNotInstalledError themselves — fetching the
// head commit, creating the tree/commit, updating the ref, syncing docs
// from upstream. Rather than individually wrap every one of those call
// sites, this catches the same 403/404-on-a-repo-that-always-exists
// pattern once, generically, at the top level: nothing else legitimately
// returns 403/404 from GitHub's API here, so any GitHubApiError with
// that status reaching this far means the same underlying cause.
function asAppNotInstalledError(err: unknown): GitHubAppNotInstalledError | null {
  if (err instanceof GitHubAppNotInstalledError) return err;
  if (err instanceof GitHubApiError && (err.status === 403 || err.status === 404)) {
    return new GitHubAppNotInstalledError(GITHUB_APP_INSTALL_URL);
  }
  return null;
}
import path from "path";
import * as fs from "fs-extra";
import multer from "multer";
import { isSafePathSegment, isSafeRelativePath } from "../safePath";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Root-level file (sibling of docs/, versioned_docs/) holding cspell's
// custom project dictionary. Tracked specially so spell-checker additions
// can flow through the same scan/commit/PR pipeline as doc edits.
const PROJECT_WORDS_FILE = "project-words.txt";

/* ============================================================
   1. AUTH + WORKSPACE ROOT
   ============================================================ */

function requireToken(req: Request, res: Response) {
  // login comes from the session, not the request — a client-supplied
  // login query param would let anyone act as any GitHub username who has
  // ever authenticated with this app, since that's all getTokenForUser
  // needs to hand back their stored token.
  const login = req.session?.login;
  const workspace = (req.query.workspace as string) || req.body?.workspace;

  if (!login) {
    res.status(401).json({ error: "Not signed in" });
    return null;
  }

  // workspace is a single directory name (never contains "/"), unlike the
  // doc-relative paths validated elsewhere — reject anything that could
  // walk out of workspaces/<login>/ before it's ever joined into a path.
  if (!isSafePathSegment(workspace)) {
    res.status(400).json({ error: "Missing or invalid workspace" });
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

type WorkspaceTreeNode =
  | { type: "dir"; name: string; path: string; children: WorkspaceTreeNode[] }
  | { type: "file"; name: string; path: string };

async function walkLocalWorkspaceTree(
  rootPath: string,
  prefix: string,
): Promise<WorkspaceTreeNode> {
  const node: WorkspaceTreeNode = {
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
  if (!isSafeRelativePath(folder) || !isSafePathSegment(file.originalname)) {
    return res.status(400).json({ error: "Invalid folder or file name" });
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

    if (!isSafeRelativePath(filePath)) {
      return res.status(400).json({ error: "Invalid path" });
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

    if (!isSafeRelativePath(clean)) {
      return res.status(400).json({ error: "Invalid path" });
    }

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

  // ws and clean come straight from the query string, not from
  // requireToken()'s already-validated workspace — validate them here too
  // before either ever reaches path.join.
  if (!isSafePathSegment(ws) || !isSafeRelativePath(clean)) {
    return res.status(400).json({ error: "Invalid path" });
  }

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

  // res.sendFile() streams the response and reports errors (ENOENT etc.)
  // asynchronously via this callback — it never throws synchronously, so
  // the try/catch this replaced could never actually catch anything; any
  // failure fell through to Express's own default error handler instead,
  // which is where the plain-HTML 404 body some requests got was coming
  // from, with no indication here of why.
  //
  // dotfiles: "allow" is required on Linux specifically: the send package
  // (which sendFile uses internally) 404s any path with a segment
  // starting with "." unless told otherwise, and Electron's own userData
  // directory on Linux is `~/.config/<app>` — ".config" itself is such a
  // segment. Every file in every workspace lived under that prefix, so
  // this 404'd every single image on Linux while working fine on Windows
  // (%APPDATA%\<app> has no dot-prefixed segment). fullPath is always
  // our own app-data tree, never anything path-supplied without going
  // through isSafePathSegment/isSafeRelativePath above, so there's no
  // real dotfile-traversal risk being allowed here.
  res.sendFile(fullPath, { dotfiles: "allow" }, (err) => {
    if (err) {
      console.error("images/local: sendFile failed for", fullPath, err);
      if (!res.headersSent) res.status(404).end();
    }
  });
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

    if (!isSafeRelativePath(filePath)) {
      return res.status(400).json({ error: "Invalid path" });
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
   9b. CREATE NEW FILE
   ============================================================ */

router.post("/create", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login, workspace } = auth;
  let { path: filePath, content } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: "Missing path" });
  }

  try {
    filePath = String(filePath).replace(/\\/g, "/");

    if (filePath.startsWith("local-workspace/")) {
      const [, , ...rest] = filePath.split("/");
      filePath = rest.join("/");
    }

    if (!isSafeRelativePath(filePath)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    const fullPath = path.join(
      process.cwd(),
      "workspaces",
      login,
      workspace,
      filePath,
    );

    if (await fs.pathExists(fullPath)) {
      return res.status(409).json({ error: "A file already exists at that path" });
    }

    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content ?? "", "utf8");

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Failed to create file" });
  }
});

// Minimal shapes for the two GitHub Git Data / Contents API responses used
// below — just enough to narrow githubRequest()'s otherwise-unknown result.
interface GitHubTreeResponse {
  tree: Array<{ path: string; type: string; sha: string }>;
}

interface GitHubFileContentResponse {
  content: string;
  encoding: string;
}

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

    const tree = await githubRequest<GitHubTreeResponse>(
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

      const file = await githubRequest<GitHubFileContentResponse>(
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

// Plain function, not just the route handler below, so /submit-pr can call
// it directly in-process instead of over an HTTP self-call (which stopped
// carrying valid auth once this route started requiring a session).
export async function scanLocalChanges(login: string, workspace: string) {
  const workspaceRoot = path.join(
    process.cwd(),
    "workspaces",
    login,
    workspace,
  );
  const mirrorRoot = path.join(workspaceRoot, "mirror");

  const localFiles = await walkLocalTree(workspaceRoot);
  const mirrorFiles = await walkLocalTree(mirrorRoot);

  const added: { path: string; type: string }[] = [];
  const modified: { path: string; type: string }[] = [];
  const deleted: { path: string; type: string }[] = [];

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
      // Compares actual bytes, not size+mtime — mtime in particular
      // depends on exactly how/when the local and mirror copies were each
      // written to disk, which can differ (sometimes only by
      // milliseconds, sometimes because of filesystem mtime-precision
      // differences between platforms) even when their content is
      // genuinely byte-identical, flagging every image in a workspace as
      // "modified" with nothing actually changed.
      const [localBuf, mirrorBuf] = await Promise.all([
        fs.readFile(localPath),
        fs.readFile(mirrorPath),
      ]);

      if (!localBuf.equals(mirrorBuf)) {
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

  return { added, modified, deleted, renamed: [] };
}

router.get("/scan-local-changes", async (req, res) => {
  const auth = requireToken(req, res);
  if (!auth) return;

  const { login, workspace } = auth;

  try {
    const result = await scanLocalChanges(login, workspace);
    return res.json(result);
  } catch {
    return res.status(500).json({ error: "Failed to scan local changes" });
  }
});

/* ============================================================
   12. CREATE WORKSPACE (COPY FROM GLOBAL MIRROR)
   ============================================================ */

router.post("/create-workspace", async (req, res) => {
  const login = req.session?.login;
  const workspace = req.body.workspace as string;

  console.log("📡 /create-workspace called:", login, workspace);

  if (!login) {
    return res.status(401).json({ error: "Not signed in" });
  }
  if (!isSafePathSegment(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }

  try {
    const token = getTokenForUser(login);

    // 1. Ensure global mirror is current
    console.log("🔧 create-workspace: ensuring global mirror is up to date…");
    await ensureMirrorUpToDate(token);
    console.log("✅ create-workspace: global mirror ready");

    // 2. Create workspace root
    const workspaceRoot = path.join(
      process.cwd(),
      "workspaces",
      login,
      workspace,
    );
    await fs.ensureDir(workspaceRoot);

    // 3. Load workspace mirror (baseline) — called directly rather than
    // over the old HTTP self-call, which stopped carrying valid auth once
    // that route started requiring a session (a server-to-server fetch()
    // doesn't have the original browser's session cookie).
    try {
      await loadWorkspaceMirror(login, workspace);
    } catch (err) {
      console.error("Failed to load workspace mirror:", err);
      return res.status(500).json({ error: "Failed to load workspace mirror" });
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

    console.log("✅ create-workspace: done:", workspace);
    return res.json({ ok: true, workspace });
  } catch (err) {
    console.error("❌ Failed to create workspace:", err);
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

  // Calls the same functions /docs/scan-local-changes, /git/commit, and
  // /git/pr each use directly, in-process, rather than the HTTP
  // self-calls this used to make — those relied on passing ?login= on
  // the URL, which stopped being valid auth once every route started
  // deriving identity from the session instead (a server-to-server
  // fetch() doesn't carry the original browser's session cookie).
  try {
    const scan = await scanLocalChanges(login, workspace);

    // Previously ignored: a failed commit (e.g. GitHub API/auth error)
    // still fell through to attempting a PR, either against stale content
    // or failing later with no clear signal of what actually went wrong.
    try {
      await commitChanges(login, workspace, scan);
    } catch (err) {
      console.error("submit-pr: commit step failed:", err);
      if (err instanceof GitHubRateLimitError) {
        return res.status(429).json({
          status: "error",
          error: err.message,
          retryAfterSeconds: err.retryAfterSeconds,
        });
      }
      const notInstalled = asAppNotInstalledError(err);
      if (notInstalled) {
        return res.status(403).json({
          status: "error",
          error: notInstalled.message,
          installUrl: notInstalled.installUrl,
        });
      }
      const error =
        err instanceof ForkError ? err.message : "Failed to commit changes";
      return res.status(err instanceof ForkError ? 409 : 500).json({
        status: "error",
        error,
      });
    }

    try {
      const prRes = await submitPullRequest(login, workspace, description);
      return res.json(prRes);
    } catch (err) {
      console.error("submit-pr: PR step failed:", err);
      if (err instanceof GitHubRateLimitError) {
        return res.status(429).json({
          status: "error",
          error: err.message,
          retryAfterSeconds: err.retryAfterSeconds,
        });
      }
      const notInstalled = asAppNotInstalledError(err);
      if (notInstalled) {
        return res.status(403).json({
          status: "error",
          error: notInstalled.message,
          installUrl: notInstalled.installUrl,
        });
      }
      return res.status(500).json({
        status: "error",
        error: "Failed to create/update PR",
      });
    }
  } catch (err) {
    console.error("submit-pr failed:", err);
    return res.status(500).json({ status: "error", error: "Failed to submit PR" });
  }
});

/* ============================================================
   14. LIST USER WORKSPACES
   ============================================================ */

router.get("/list-user-workspaces", async (req, res) => {
  const login = req.session?.login;

  if (!login) {
    return res.status(401).json({ error: "Not signed in" });
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
  const login = req.session?.login;
  const workspace = req.query.workspace as string;

  console.log("Delete workspace request:", login, workspace);

  if (!login) {
    return res.status(401).json({ error: "Not signed in" });
  }
  // This recursively force-deletes whatever path it's given — validating
  // workspace matters even more here than on read-only routes.
  if (!isSafePathSegment(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
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
  const login = req.session?.login;
  const workspace = req.query.workspace as string;

  if (!login) {
    return res.status(401).json({ error: "Not signed in" });
  }
  if (!isSafePathSegment(workspace)) {
    return res.status(400).json({ error: "Invalid workspace" });
  }

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
