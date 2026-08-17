/* frontend/src/hooks/useDocTrees.ts
 *
 * Description of responsibility:
 *   Loads and holds the sidebar file tree for every workspace the user
 *   has, and exposes refreshLocalWorkspace() to reload a single
 *   workspace's tree after a file is added/moved/deleted.
 *
 * Info:
 *   Fetches every workspace's tree up front on login/workspace-list
 *   change rather than lazily per-workspace, since the sidebar renders
 *   all workspaces' trees simultaneously (each in its own collapsible
 *   block), not just the active one.
 */
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
    // Rebound to a plain `string`: TS narrows `login` to non-null here, but
    // that narrowing doesn't carry into the separately-scoped loadAllLocal
    // closure below — a fresh binding does.
    const currentLogin = login;

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
              currentLogin,
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
