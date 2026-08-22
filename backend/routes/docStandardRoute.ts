/* backend/routes/docStandardRoute.ts
 *
 * Description of responsibility:
 *   Proxies the remote MDX doc-standard config (docStandard.json, read
 *   from the rotorflight-docs repo) to the frontend, so docStandard.ts
 *   can pick up changes to which imports the MD->MDX conversion
 *   requires without every install needing to update — the same
 *   raw.githubusercontent.com passthrough shape as version.ts's
 *   docEditorStatus.json, just a different file and a different
 *   consumer.
 *
 * Info:
 *   A thin passthrough rather than an auth-gated route — like
 *   docEditorStatus.json, this config is public info already, so it
 *   deliberately doesn't require a session. The frontend falls back to
 *   its own baked-in default list if this route errors or the file
 *   doesn't exist yet upstream, so this can ship before docStandard.json
 *   is actually added to the docs repo.
 */
import express from "express";

const router = express.Router();

const REMOTE_JSON_URL =
  "https://raw.githubusercontent.com/rotorflight/rotorflight-docs/main/config/docStandard.json";

router.get("/doc-standard", async (req, res) => {
  try {
    const response = await fetch(REMOTE_JSON_URL, {
      headers: { "Cache-Control": "no-cache" },
    });

    if (!response.ok) {
      return res.status(500).json({ error: "Failed to fetch doc standard config" });
    }

    const cfg = await response.json();
    res.json(cfg);
  } catch (err) {
    console.error("Error fetching remote doc standard JSON:", err);
    res.status(500).json({ error: "Failed to load doc standard config" });
  }
});

export default router;
