router.post("/merge-all-workspaces", async (req, res) => {
  try {
    const base = path.join(process.cwd(), "mirror-old");
    const theirs = path.join(process.cwd(), "mirror");
    const workspacesRoot = path.join(process.cwd(), "workspaces");

    console.log("MERGE: computing upstream diff...");
    const upstream = await computeUpstreamDiff(base, theirs);

    console.log("MERGE: applying upstream diff to all workspaces...");
    const workspaceNames = await fs.readdir(workspacesRoot);

    const results = [];

    for (const name of workspaceNames) {
      const workspacePath = path.join(workspacesRoot, name, "workspace");

      if (!(await fs.pathExists(workspacePath))) continue;

      const result = await applyUpstreamToWorkspace(
        workspacePath,
        base,
        theirs,
        upstream,
      );

      results.push({ workspace: name, ...result });
    }

    return res.json({ ok: true, results });
  } catch (err) {
    console.error("MERGE ERROR:", err);
    return res.status(500).json({ error: "Merge failed" });
  }
});
