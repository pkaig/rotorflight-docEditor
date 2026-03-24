import { useEffect, useState } from "react";

interface WorkspaceSelectorProps {
  login: string;
  onSelect: (workspace: string) => void;
}

export function WorkspaceSelector({ login, onSelect }: WorkspaceSelectorProps) {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  //
  // Load existing workspaces for this user
  //
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          `/api/docs/list-user-workspaces?login=${login}`,
        );
        const data = await res.json();
        setWorkspaces(data.workspaces || []);
      } catch {
        setWorkspaces([]);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [login]);

  //
  // Create a new workspace
  //
  async function handleCreate() {
    if (!newName.trim()) return;

    setCreating(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/docs/create-workspace?login=${encodeURIComponent(login)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace: newName.trim() }),
        },
      );

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create workspace");
        setCreating(false);
        return;
      }

      // Add to list + select it
      setWorkspaces((prev) => [...prev, newName.trim()]);
      onSelect(newName.trim());
    } catch (err) {
      setError("Failed to create workspace");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Loading workspaces…</h2>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", maxWidth: "500px", margin: "0 auto" }}>
      <h2>Select a Workspace</h2>

      {workspaces.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          {workspaces.map((ws) => (
            <button
              key={ws}
              onClick={() => onSelect(ws)}
              style={{
                display: "block",
                width: "100%",
                padding: "0.75rem",
                marginBottom: "0.5rem",
                textAlign: "left",
                borderRadius: "6px",
                border: "1px solid #ccc",
                background: "#f7f7f7",
              }}
            >
              {ws}
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: "2rem" }}>
        <h3>Create New Workspace</h3>

        <input
          type="text"
          placeholder="e.g. modify-gov"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{
            width: "100%",
            padding: "0.5rem",
            marginBottom: "0.5rem",
            borderRadius: "4px",
            border: "1px solid #ccc",
          }}
        />

        <button
          onClick={handleCreate}
          disabled={creating}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "6px",
            background: "#007bff",
            color: "white",
            border: "none",
          }}
        >
          {creating ? "Creating…" : "Create Workspace"}
        </button>

        {error && <p style={{ color: "red", marginTop: "0.5rem" }}>{error}</p>}
      </div>
    </div>
  );
}
