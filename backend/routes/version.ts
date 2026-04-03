import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const REMOTE_JSON_URL =
  "https://raw.githubusercontent.com/rotorflight/rotorflight-docs/main/config/docEditorStatus.json";

router.get("/version", async (req, res) => {
  try {
    const response = await fetch(REMOTE_JSON_URL, {
      headers: { "Cache-Control": "no-cache" },
    });

    if (!response.ok) {
      console.error("Failed to fetch remote version JSON:", response.status);
      return res.status(500).json({ error: "Failed to fetch version config" });
    }

    const cfg = await response.json();
    res.json(cfg);
  } catch (err) {
    console.error("Error fetching remote version JSON:", err);
    res.status(500).json({ error: "Failed to load version config" });
  }
});

export default router;
