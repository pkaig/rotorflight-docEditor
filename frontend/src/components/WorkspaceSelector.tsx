import { useEffect, useState } from "react";

interface WorkspaceSelectorProps {
  login: string;
  onSelect: (workspace: string | null) => void;
}

export function WorkspaceSelector({ login, onSelect }: WorkspaceSelectorProps) {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ADD THIS — you already have it
  const [isInvalid, setIsInvalid] = useState(false);

  //
  // Load existing workspaces
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
  // Validate as user types
  //
  useEffect(() => {
    const trimmed = newName.trim();
    const invalid =
      trimmed.length === 0 ||
      trimmed.includes(" ") ||
      trimmed.includes("/") ||
      trimmed.includes("\\") ||
      trimmed.includes("..");

    setIsInvalid(invalid);
  }, [newName]);

  //
  // Keyboard shortcuts: Enter = create, Escape = cancel
  //
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onSelect(null);
      }
      if (e.key === "Enter" && !isInvalid) {
        onSelect(newName.trim());
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [newName, isInvalid, onSelect]);

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

        {/* UPDATED: add invalid class */}
        <input
          className={`workspace-input ${isInvalid ? "invalid" : ""}`}
          type="text"
          placeholder="e.g. modify-gov"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          autoFocus
        />

        {/* NEW: inline error message */}
        {isInvalid && (
          <div className="workspace-input-error">Workspace name is invalid</div>
        )}

        <div className="workspace-selector-buttons">
          {/* UPDATED: disable when invalid */}
          <button
            className="workspace-create-btn"
            disabled={isInvalid}
            onClick={() => !isInvalid && onSelect(newName.trim())}
          >
            Create Workspace
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
