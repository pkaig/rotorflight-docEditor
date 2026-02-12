import express from "express";
import fetch from "node-fetch";
import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } from "./config/github";
import { githubRequest } from "./githubClient";

const router = express.Router();

// In-memory token store
let currentAccessToken: string | null = null;

// -----------------------------
// Start Device Flow
// -----------------------------
router.post("/device/start", async (req, res) => {
  console.log("📡 /device/start called");

  const params = new URLSearchParams();
  params.append("client_id", GITHUB_CLIENT_ID);
  params.append("scope", "repo");

  console.log("➡️ Sending to GitHub /device/code:", params.toString());

  const resp = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  console.log("⬅️ GitHub /device/code status:", resp.status);

  const data = await resp.json();
  console.log("⬅️ GitHub /device/code response:", data);

  res.json({
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    interval: data.interval,
  });
});

// -----------------------------
// Poll for Token
// -----------------------------
router.post("/device/poll", async (req, res) => {
  console.log("📡 /device/poll called with:", req.body);

  const params = new URLSearchParams();
  params.append("client_id", GITHUB_CLIENT_ID);
  params.append("client_secret", GITHUB_CLIENT_SECRET);
  params.append("device_code", req.body.device_code);
  params.append("grant_type", "urn:ietf:params:oauth:grant-type:device_code");

  console.log("➡️ Sending to GitHub /access_token:", params.toString());

  const resp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  console.log("⬅️ GitHub /access_token status:", resp.status);

  const data = await resp.json();
  console.log("⬅️ GitHub /access_token response:", data);

  if (data.error) {
    console.log("⚠️ GitHub returned error:", data.error);
    return res.json({ status: "pending", error: data.error });
  }

  console.log("✅ GitHub returned access token:", data.access_token);
  currentAccessToken = data.access_token;

  res.json({ status: "ok" });
});

// -----------------------------
// Auth Status
// -----------------------------
router.get("/status", (req, res) => {
  res.json({ authenticated: !!currentAccessToken });
});

// -----------------------------
// Get User Info
// -----------------------------
export function getAccessTokenOrThrow(): string {
  if (!currentAccessToken) throw new Error("Not authenticated with GitHub");
  return currentAccessToken;
}

router.get("/me", async (req, res) => {
  try {
    const token = getAccessTokenOrThrow();
    const user = await githubRequest<any>(token, "/user");

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

export default router;
