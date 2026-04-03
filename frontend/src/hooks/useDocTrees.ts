import { useEffect, useState } from "react";
import type { TreeNode } from "../components/Tree";

export function useDocTrees(
  login: string | null,
  workspaces: string[],
  isAuthenticated: boolean,
) {
  const [localTrees, setLocalTrees] = useState<Record<string, TreeNode[]>>({});
  const [loadingLocal, setLoadingLocal] = useState(true);

  /* -------------------------------------------------------
     INITIAL LOAD — LOCAL WORKSPACES ONLY
  ------------------------------------------------------- */
  useEffect(() => {
    if (!isAuthenticated || !login) return;

    if (workspaces.length === 0) {
      setLocalTrees({});
      setLoadingLocal(false);
      return;
    }

    async function loadAllLocal() {
      const results: Record<string, TreeNode[]> = {};

      for (const ws of workspaces) {
        try {
          const res = await fetch(
            `/api/docs/list-local?login=${encodeURIComponent(
              login,
            )}&workspace=${encodeURIComponent(ws)}`,
          );

          if (!res.ok) continue;

          const { docs } = await res.json();
          results[ws] = docs;
        } catch (err) {
          console.error("Local load failed", err);
        }
      }

      setLocalTrees(results);
      setLoadingLocal(false);
    }

    setLoadingLocal(true);
    loadAllLocal();
  }, [isAuthenticated, login, workspaces]);

  /* -------------------------------------------------------
     REFRESH A SINGLE WORKSPACE
  ------------------------------------------------------- */
  async function refreshLocalWorkspace(ws: string) {
    if (!login) return;

    const res = await fetch(
      `/api/docs/list-local?login=${encodeURIComponent(
        login,
      )}&workspace=${encodeURIComponent(ws)}`,
    );

    const data = await res.json();

    setLocalTrees((prev) => ({
      ...prev,
      [ws]: data.docs,
    }));

    return data.docs;
  }

  return {
    localTrees,
    loadingLocal,
    refreshLocalWorkspace,
  };
}
