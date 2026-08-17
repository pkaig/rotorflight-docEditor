/* frontend/src/hooks/useWorkspaces.ts
 *
 * Description of responsibility:
 *   Loads and holds the list of the current user's workspace names
 *   (not their contents — see useDocTrees for that) for the sidebar and
 *   workspace-management UI.
 *
 * Info:
 *   Exposes the same function under two names: refreshWorkspaces (the
 *   real name) and loadWorkspaces (kept as an alias since App.tsx still
 *   calls it that; not yet renamed everywhere).
 */
import { useEffect, useState } from "react";

export function useWorkspaces(login: string | null) {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  async function refreshWorkspaces() {
    if (!login) return;

    const res = await fetch(`/api/docs/list-user-workspaces?login=${login}`);
    const data = await res.json();

    setWorkspaces(data.workspaces || []);
    setLoading(false);
  }

  useEffect(() => {
    refreshWorkspaces();
  }, [login]);

  return {
    workspaces,
    loading,
    refreshWorkspaces, // ← MUST BE RETURNED
    loadWorkspaces: refreshWorkspaces, // ← DEPRECATED, TO BE REMOVED
  };
}
