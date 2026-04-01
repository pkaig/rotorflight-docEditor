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
