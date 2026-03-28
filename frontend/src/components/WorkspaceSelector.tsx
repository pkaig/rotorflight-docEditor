import { useEffect, useState } from "react";

interface WorkspaceSelectorProps {
  login: string;
  onSelect: (workspace: string | null) => void;
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
      <div className="workspace-selector-loading">
        <h2>Loading workspaces…</h2>
      </div>
    );
  }

  return (
    <div className="workspace-selector-container">
      <div className="workspace-selector-inner">
        <h3>Create New Workspace</h3>

        <input
          className="workspace-input"
          type="text"
          placeholder="e.g. modify-gov"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />

        <div className="workspace-selector-buttons">
          <button
            className="workspace-create-btn"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? "Creating…" : "Create Workspace"}
          </button>

          <button
            className="workspace-cancel-btn"
            onClick={() => onSelect(null)}
          >
            Cancel
          </button>
        </div>

        {error && <p className="workspace-error">{error}</p>}
      </div>
    </div>
  );
}
