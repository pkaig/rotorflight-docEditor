import { useEffect, useState } from "react";
import type { TreeNode } from "../components/Tree";

const HASH_KEY = "rf_github_hash";
const TREE_KEY = "rf_github_tree";

export function useDocTrees(
  login: string | null,
  workspaces: string[],
  isAuthenticated: boolean,
) {
  const [localTrees, setLocalTrees] = useState<Record<string, TreeNode[]>>({});
  const [githubTree, setGithubTree] = useState<TreeNode | null>(null);

  const [loadingLocal, setLoadingLocal] = useState(true);
  const [loadingGithub, setLoadingGithub] = useState(true);

  /* -------------------------------------------------------
     Helper: flatten local workspace tree
     Extracts only: docs + versioned_docs
  ------------------------------------------------------- */
  function flattenLocalTree(docs: TreeNode[] | null, ws: string): TreeNode[] {
    if (!docs) return [];

    // Find workspace root
    const root = docs.find((n) => n.name === ws);
    if (!root) return [];

    // Find Rotorflight-docs wrapper
    const rf = root.children?.find((n) => n.name === "Rotorflight-docs");
    if (!rf) return [];

    // Return only docs + versioned_docs
    return rf.children || [];
  }

  /* -------------------------------------------------------
     INITIAL LOAD
  ------------------------------------------------------- */
  useEffect(() => {
    if (!isAuthenticated || !login) return;

    if (workspaces.length === 0) {
      setLocalTrees({});
      setGithubTree(null);
      setLoadingLocal(false);
      setLoadingGithub(false);
      return;
    }

    const primaryWorkspace = workspaces[0];

    setLoadingLocal(true);
    setLoadingGithub(true);

    /* -------------------------------------------------------
       LOAD GITHUB TREE
    ------------------------------------------------------- */
    async function loadGithub() {
      try {
        const cachedHash = localStorage.getItem(HASH_KEY);
        const cachedTree = localStorage.getItem(TREE_KEY);

        const hashRes = await fetch(
          `/api/docs/github-hash?login=${encodeURIComponent(
            login,
          )}&workspace=${encodeURIComponent(primaryWorkspace)}`,
        );

        if (!hashRes.ok) {
          console.warn("⚠️ Failed to fetch GitHub hash");
          setLoadingGithub(false);
          return;
        }

        const { hash: currentHash } = await hashRes.json();

        if (cachedHash && cachedHash === currentHash && cachedTree) {
          const parsed = JSON.parse(cachedTree);
          const githubRoot = parsed.find(
            (n: TreeNode) => n.name === "Rotorflight-docs",
          );

          setGithubTree(githubRoot || null);
          setLoadingGithub(false);
          return;
        }

        const ghRes = await fetch(
          `/api/docs/list-github?login=${encodeURIComponent(
            login,
          )}&workspace=${encodeURIComponent(primaryWorkspace)}`,
        );

        if (!ghRes.ok) {
          console.warn("⚠️ Failed to fetch GitHub tree");
          setLoadingGithub(false);
          return;
        }

        const { docs } = await ghRes.json();

        localStorage.setItem(TREE_KEY, JSON.stringify(docs));
        localStorage.setItem(HASH_KEY, currentHash);

        const githubRoot = docs.find(
          (n: TreeNode) => n.name === "Rotorflight-docs",
        );

        setGithubTree(githubRoot || null);
        setLoadingGithub(false);
      } catch (err) {
        console.error("GitHub load failed", err);
        setLoadingGithub(false);
      }
    }

    /* -------------------------------------------------------
       LOAD LOCAL TREES FOR ALL WORKSPACES
    ------------------------------------------------------- */
    async function loadAllLocal() {
      const results: Record<string, TreeNode[]> = {};

      for (const ws of workspaces) {
        try {
          const res = await fetch(
            `/api/docs/list-local?login=${encodeURIComponent(
              login,
            )}&workspace=${encodeURIComponent(ws)}`,
          );

          if (!res.ok) {
            console.warn(`⚠️ Failed to fetch local workspace: ${ws}`);
            continue;
          }

          const { docs } = await res.json();

          // Flatten
          results[ws] = flattenLocalTree(docs, ws);
        } catch (err) {
          console.error("Local load failed", err);
        }
      }

      setLocalTrees(results);
      setLoadingLocal(false);
    }

    loadGithub();
    loadAllLocal();
  }, [isAuthenticated, login, workspaces]);

  /* -------------------------------------------------------
     REFRESH LOCAL FOR A SINGLE WORKSPACE
  ------------------------------------------------------- */
  async function refreshLocalWorkspace(ws: string) {
    if (!login) return;

    const res = await fetch(
      `/api/docs/list-local?login=${encodeURIComponent(
        login,
      )}&workspace=${encodeURIComponent(ws)}`,
    );

    const data = await res.json();

    const flattened = flattenLocalTree(data.docs, ws);

    setLocalTrees((prev) => ({
      ...prev,
      [ws]: flattened,
    }));

    return flattened;
  }

  /* -------------------------------------------------------
     REFRESH GITHUB TREE
  ------------------------------------------------------- */
  function refreshGitHubTree(ws: string) {
    if (!login) return;

    fetch(
      `/api/docs/list-github?login=${encodeURIComponent(
        login,
      )}&workspace=${encodeURIComponent(ws)}`,
    )
      .then((res) => res.json())
      .then((data) => {
        setGithubTree(
          data.docs.find((x: TreeNode) => x.name === "Rotorflight-docs") ||
            null,
        );
      });
  }

  return {
    localTrees,
    githubTree,
    loadingLocal,
    loadingGithub,
    refreshLocalWorkspace,
    refreshGitHubTree,
  };
}
