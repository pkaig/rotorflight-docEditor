import express from "express";
import * as fs from "fs-extra";
import path from "path";
import { computeUpstreamDiff } from "../merge/computeUpstreamDiff";
import { applyUpstreamToWorkspace } from "../merge/applyUpstream";

const router = express.Router();

router.post("/merge-workspace", async (req, res) => {
  try {
    const baseDir = path.join(process.cwd(), "workspaces", login, "mirror");
    const newDir = path.join(process.cwd(), "mirror");
    const workspacesRoot = path.join(process.cwd(), "workspaces");

    console.log("MERGE: computing upstream diff...");
    const upstream = await computeUpstreamDiff(baseDir, newDir);

    console.log("MERGE: applying upstream diff to all workspaces...");
    const workspaceNames = await fs.readdir(workspacesRoot);

    const results = [];

    for (const name of workspaceNames) {
      const wsPath = path.join(workspacesRoot, name, "workspace");

      if (!(await fs.pathExists(wsPath))) continue;

      const result = await applyUpstreamToWorkspace(
        wsPath,
        baseDir,
        newDir,
        upstream,
      );

      results.push({ workspace: name, ...result });
    }

    return res.json({ ok: true, upstream, results });
  } catch (err) {
    console.error("MERGE ERROR:", err);
    return res.status(500).json({ error: "Merge failed" });
  }
});

export default router;
