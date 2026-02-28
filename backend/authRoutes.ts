import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } from "./config/github";
import { githubRequest } from "./githubClient";

const router = express.Router();

// ---------------------------------------------
// Token Storage Directory
// ---------------------------------------------
const TOKENS_DIR = path.join(__dirname, "tokens");

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

  res.json({ status: "ok", login: user.login });
});

// ---------------------------------------------
// Auth Status
// ---------------------------------------------
router.get("/status/:login", (req, res) => {
  const login = req.params.login;
  const token = loadToken(login);
  res.json({ authenticated: !!token });
});

// ---------------------------------------------
// Get User Info
// ---------------------------------------------
router.get("/me/:login", async (req, res) => {
  const login = req.params.login;
  const token = loadToken(login);

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

export default router;
