/* backend/routes/authRoutes.ts
 *
 * Description of responsibility:
 *   Implements GitHub's OAuth device flow (start/poll) and owns the
 *   server-side session: it's the only place req.session.login ever
 *   gets set, and it exposes /session, /status/:login, /me/:login and
 *   /logout for the frontend to read and clear that session. Also
 *   stores each user's GitHub access token on disk
 *   (routes/tokens/<login>.json) and exposes getTokenForUser() for the
 *   rest of the backend.
 *
 * Info:
 *   /status/:login and /me/:login only ever answer for the caller's own
 *   session login, never an arbitrary :login param — otherwise anyone
 *   could probe whether any GitHub username has used this app. Identity
 *   is established exactly once, in /device/poll, right after GitHub
 *   confirms the token; nothing downstream trusts a client-supplied
 *   login value. Token file paths use process.cwd() rather than
 *   __dirname so they resolve the same whether running from source
 *   (ts-node-dev) or compiled dist/ output.
 */
import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } from "../config/github";
import { githubRequest } from "../githubClient";
import { ensureFork } from "../ensureFork";

const router = express.Router();

// ---------------------------------------------
// Token Storage Directory
// ---------------------------------------------
// process.cwd() rather than __dirname — matches how every other file-storage
// path in this app is computed (workspaces/, mirror/), and unlike __dirname
// it resolves to the same place whether this runs from source (ts-node-dev)
// or from compiled dist/routes/authRoutes.js, so a production build doesn't
// silently start looking for tokens in the wrong directory.
const TOKENS_DIR = path.join(process.cwd(), "routes", "tokens");

if (!fs.existsSync(TOKENS_DIR)) {
  fs.mkdirSync(TOKENS_DIR);
  console.log("📁 Created tokens directory:", TOKENS_DIR);
}

// ---------------------------------------------
// Helpers
// ---------------------------------------------
interface StoredToken {
  access_token: string;
  expires_at: number;
  login: string;
}

function tokenPath(login: string) {
  return path.join(TOKENS_DIR, `${login}.json`);
}

function loadToken(login: string): StoredToken | null {
  const file = tokenPath(login);
  if (!fs.existsSync(file)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));

    // Validate expires_at
    if (
      !data.expires_at ||
      typeof data.expires_at !== "number" ||
      Number.isNaN(data.expires_at)
    ) {
      console.warn(
        `Token for ${login} missing or invalid expires_at, deleting`,
      );
      fs.unlinkSync(file);
      return null;
    }

    // Check expiration
    if (Date.now() > data.expires_at) {
      console.log(`⏳ Token for ${login} expired, deleting`);
      fs.unlinkSync(file);
      return null;
    }

    return data;
  } catch (err) {
    console.error("Failed to load token:", err);
    return null;
  }
}

function saveToken(token: StoredToken) {
  const file = tokenPath(token.login);
  fs.writeFileSync(file, JSON.stringify(token, null, 2), "utf8");
  console.log(`💾 Saved token for ${token.login}`);
}

// ---------------------------------------------
// Start Device Flow
// ---------------------------------------------
router.post("/device/start", async (_req, res) => {
  console.log("📡 /device/start called");

  const params = new URLSearchParams();
  params.append("client_id", GITHUB_CLIENT_ID);
  params.append("scope", "repo");

  const resp = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await resp.json();
  console.log("⬅️ GitHub /device/code:", data);

  res.json({
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    interval: data.interval,
  });
});

// ---------------------------------------------
// Poll for Token
// ---------------------------------------------
router.post("/device/poll", async (req, res) => {
  console.log("📡 /device/poll called");

  const params = new URLSearchParams();
  params.append("client_id", GITHUB_CLIENT_ID);
  params.append("client_secret", GITHUB_CLIENT_SECRET);
  params.append("device_code", req.body.device_code);
  params.append("grant_type", "urn:ietf:params:oauth:grant-type:device_code");

  const resp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await resp.json();
  console.log("⬅️ GitHub /access_token:", data);

  if (data.error) {
    return res.json({ status: "pending", error: data.error });
  }

  // Fetch user identity
  const user = await githubRequest<any>(data.access_token, "/user");

  // 🔐 Verify token scopes BEFORE saving
  await assertRepoScope(data.access_token);

  // Compute expiration safely
  const expires_at =
    typeof data.expires_in === "number"
      ? Date.now() + data.expires_in * 1000
      : Date.now() + 8 * 60 * 60 * 1000; // fallback: 8 hours

  const token: StoredToken = {
    access_token: data.access_token,
    expires_at,
    login: user.login,
  };

  saveToken(token);

  // This is the actual authentication boundary: everything downstream
  // (docsRoutes/gitRoutes/resetMirror) identifies "who is making this
  // request" from req.session.login, never from a client-supplied login
  // field, so this is the one place that gets to set it.
  req.session.login = token.login;

  // Fire-and-forget: starts fork creation as early as possible so it has
  // time to become usable before the user gets to submitting a PR, without
  // making login wait on it. ensureFork() is called again before any
  // actual commit (gitRoutes.ts), so a user submitting within seconds of
  // this is still handled correctly — this is purely a head start.
  ensureFork(token.access_token, token.login).catch((err) => {
    console.error(`ensureFork failed for ${token.login} after login:`, err);
  });

  res.json({ status: "ok", login: user.login });
});

// ---------------------------------------------
// Restore session on page load — the frontend can't ask "is <name>
// authenticated?" anymore (that let anyone probe/impersonate any GitHub
// username); it can only ask "who does my own session cookie belong to?".
// ---------------------------------------------
router.get("/session", (req, res) => {
  const login = req.session.login;
  const authenticated = !!login && !!loadToken(login);

  if (!authenticated) {
    // Token expired/was revoked since the cookie was issued — don't keep
    // asserting a session that no longer has a usable token behind it.
    req.session.login = undefined;
  }

  res.json({ authenticated, login: authenticated ? login : null });
});

// ---------------------------------------------
// Auth Status (legacy, param'd form) — only ever confirms the caller's OWN
// session, not an arbitrary username, so this can't be used to check
// whether someone else has authenticated with this app.
// ---------------------------------------------
router.get("/status/:login", (req, res) => {
  const authenticated =
    req.session.login === req.params.login && !!loadToken(req.params.login);
  res.json({ authenticated });
});

// ---------------------------------------------
// Get User Info — same restriction: only your own profile, derived from
// your own session, never an arbitrary :login someone else supplied.
// ---------------------------------------------
router.get("/me/:login", async (req, res) => {
  if (req.session.login !== req.params.login) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const token = loadToken(req.params.login);

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const user = await githubRequest<any>(token.access_token, "/user");
    res.json({
      login: user.login,
      name: user.name,
      avatar_url: user.avatar_url,
    });
  } catch (err) {
    console.error("Failed to fetch user:", err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// ---------------------------------------------
// Logout
// ---------------------------------------------
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// ---------------------------------------------
// Export helper for docsRoutes
// ---------------------------------------------
export function getTokenForUser(login: string): string {
  const token = loadToken(login);
  if (!token) throw new Error("User not authenticated");
  return token.access_token;
}

// ---------------------------------------------
// Block Merge Attempts
// ---------------------------------------------
router.post("/merge", (_req, res) => {
  console.log("🚫 Merge attempt blocked");
  res.status(403).json({
    error: "Merging pull requests is not allowed by this application.",
  });
});

// ---------------------------------------------
// Set Repo Scope
// ---------------------------------------------
export async function assertRepoScope(token: string) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  const scopes = res.headers.get("x-oauth-scopes") || "";
  console.log("🔐 GitHub token scopes:", scopes);

  const scopeList = scopes.split(",").map((s) => s.trim());

  if (!scopeList.includes("repo")) {
    throw new Error(
      `GitHub token missing "repo" scope. Got: [${scopes}]. ` +
        `User must re-authenticate with updated permissions.`,
    );
  }
}

export default router;
