/* backend/routes/version.ts
 *
 * Description of responsibility:
 *   Proxies the app's remote version-gate config (docEditorStatus.json,
 *   read from the rotorflight-docs repo) to the frontend, so
 *   useVersionGate.ts can decide whether to show a maintenance/upgrade
 *   banner without the browser fetching raw.githubusercontent.com
 *   directly.
 *
 * Info:
 *   A thin passthrough rather than an auth-gated route — this config is
 *   public info already, so it deliberately doesn't require a session.
 */
import express from "express";

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
