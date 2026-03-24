import { useEffect, useState } from "react";

export function useWorkspaces(login: string | null) {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!login) return;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/docs/list-workspaces?login=${login}`);
        const data = await res.json();

        // PATCH: filter out the global mirror folder
        const filtered = (data.workspaces || []).filter(
          (ws: string) => ws !== "mirror",
        );

        setWorkspaces(filtered);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [login]);

  return { workspaces, loading };
}
