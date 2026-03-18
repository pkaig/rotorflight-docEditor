import { useEffect, useState } from "react";
import type { TreeNode } from "../components/Tree";

const HASH_KEY = "rf_github_hash";
const TREE_KEY = "rf_github_tree";

export function useDocTrees(login: string | null, isAuthenticated: boolean) {
  const [localTree, setLocalTree] = useState<TreeNode | null>(null);
  const [githubTree, setGithubTree] = useState<TreeNode | null>(null);
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [loadingGithub, setLoadingGithub] = useState(true);

  useEffect(() => {
    // Critical guard: do NOT run init() until login is real
    if (!isAuthenticated || !login || login.trim() === "") return;

    async function init() {
      console.log(
        "INIT CALLED",
        new Date().getMinutes(),
        ":",
        new Date().getSeconds(),
      );

      //
      // --- GITHUB TREE (cached) ---
      //
      const cachedHash = localStorage.getItem(HASH_KEY);
      const cachedTree = localStorage.getItem(TREE_KEY);

      const hashRes = await fetch(
        `/api/docs/github-hash?login=${encodeURIComponent(login)}`,
      );

      if (!hashRes.ok) {
        console.warn("⚠️ Failed to fetch GitHub hash");
        return;
      }

      const { hash: currentHash } = await hashRes.json();

      // Use cached GitHub tree if hash matches
      if (cachedHash && cachedHash === currentHash && cachedTree) {
        const parsed = JSON.parse(cachedTree);
        const githubRoot = parsed.find(
          (n: TreeNode) => n.name === "Rotorflight-docs",
        );

        setGithubTree(githubRoot || null);
        setLoadingGithub(false);
      } else {
        // Fetch fresh GitHub + Local tree
        const treeRes = await fetch(
          `/api/docs/list?login=${encodeURIComponent(login)}`,
        );

        if (!treeRes.ok) {
          console.warn("⚠️ Failed to fetch GitHub tree");
          return;
        }

        const { docs } = await treeRes.json();

        // Cache ONLY the GitHub portion
        const githubOnly = docs.filter(
          (n: TreeNode) => n.name === "Rotorflight-docs",
        );
        localStorage.setItem(TREE_KEY, JSON.stringify(githubOnly));
        localStorage.setItem(HASH_KEY, currentHash);

        const githubRoot = docs.find(
          (n: TreeNode) => n.name === "Rotorflight-docs",
        );
        setGithubTree(githubRoot || null);
        setLoadingGithub(false);
      }

      //
      // --- LOCAL TREE (always live, never cached) ---
      //
      const localRes = await fetch(
        `/api/docs/list?login=${encodeURIComponent(login)}`,
      );
      const localData = await localRes.json();

      const localRoot = localData.docs.find(
        (n: TreeNode) => n.name === "local-workspace",
      );

      setLocalTree(localRoot || null);
      setLoadingLocal(false);
    }

    init();
  }, [isAuthenticated, login]);

  //
  // --- Refresh Local (unchanged, correct) ---
  //
  async function refreshLocalWorkspace() {
    console.log(
      "🔄 Refreshing local workspace tree...",
      new Date().getMinutes(),
    );

    if (!login) return;

    const res = await fetch(`/api/docs/list?login=${login}`);
    const data = await res.json();

    setLocalTree(
      data.docs.find((x: TreeNode) => x.name === "local-workspace") || null,
    );
  }

  //
  // --- Refresh GitHub (unchanged) ---
  //
  function refreshGitHubTree() {
    console.log("🔄 Refreshing GitHub tree...");
    if (!login) return;

    fetch(`/api/docs/list?login=${login}`)
      .then((res) => res.json())
      .then((data) => {
        setGithubTree(
          data.docs.find((x: TreeNode) => x.name === "Rotorflight-docs") ||
            null,
        );
      });
  }

  return {
    localTree,
    githubTree,
    loadingLocal,
    loadingGithub,
    refreshLocalWorkspace,
    refreshGitHubTree,
  };
}
