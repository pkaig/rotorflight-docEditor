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
    if (!isAuthenticated || !login) return;

    async function init() {
      const cachedHash = localStorage.getItem(HASH_KEY);
      const cachedTree = localStorage.getItem(TREE_KEY);

      const res = await fetch(
        `http://localhost:4000/api/docs/github-hash?login=${encodeURIComponent(
          login,
        )}`,
      );

      if (!res.ok) {
        console.warn("⚠️ Failed to fetch GitHub hash");
        return;
      }

      const { hash: currentHash } = await res.json();

      if (cachedHash && cachedHash === currentHash && cachedTree) {
        const parsed = JSON.parse(cachedTree);

        const githubRoot = parsed.find(
          (n: TreeNode) => n.name === "Rotorflight-docs",
        );
        const localRoot = parsed.find(
          (n: TreeNode) => n.name === "local-workspace",
        );

        setGithubTree(githubRoot || null);
        setLocalTree(localRoot || null);

        setLoadingGithub(false);
        setLoadingLocal(false);
        return;
      }

      const treeRes = await fetch(
        `http://localhost:4000/api/docs/list?login=${encodeURIComponent(
          login,
        )}`,
      );

      if (!treeRes.ok) {
        console.warn("⚠️ Failed to fetch GitHub tree");
        return;
      }

      const { docs } = await treeRes.json();

      localStorage.setItem(TREE_KEY, JSON.stringify(docs));
      localStorage.setItem(HASH_KEY, currentHash);

      const githubRoot = docs.find(
        (n: TreeNode) => n.name === "Rotorflight-docs",
      );
      const localRoot = docs.find(
        (n: TreeNode) => n.name === "local-workspace",
      );

      setGithubTree(githubRoot || null);
      setLocalTree(localRoot || null);

      setLoadingGithub(false);
      setLoadingLocal(false);
    }

    init();
  }, [isAuthenticated, login]);

  async function refreshLocalWorkspace() {
    if (!login) return;
    const res = await fetch(`/api/docs/list?login=${login}`);
    const data = await res.json();
    setLocalTree(data.docs.find((x: TreeNode) => x.name === "local-workspace"));
  }

  function refreshGitHubTree() {
    if (!login) return;
    fetch(`/api/docs/list?login=${login}`)
      .then((res) => res.json())
      .then((data) => {
        setGithubTree(
          data.docs.find((x: TreeNode) => x.name === "Rotorflight-docs"),
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
