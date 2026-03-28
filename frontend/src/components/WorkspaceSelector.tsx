import { useEffect, useState } from "react";
import { validateWorkspaceName } from "../utils/validateWorkspaceName";

interface WorkspaceSelectorProps {
  login: string;
  onSelect: (workspace: string | null) => void;
}

export function WorkspaceSelector({ login, onSelect }: WorkspaceSelectorProps) {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);

  // NEW: store the validator output
  const [validationError, setValidationError] = useState<string | null>(null);

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
  // Validate using the REAL validator
  //
  useEffect(() => {
    const trimmed = newName.trim();
    const error = validateWorkspaceName(trimmed);
    setValidationError(error);
  }, [newName]);

  //
  // Keyboard shortcuts
  //
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onSelect(null);
      }
      if (e.key === "Enter" && !validationError) {
        onSelect(newName.trim());
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [newName, validationError, onSelect]);

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
          className={`workspace-input ${validationError ? "invalid" : ""}`}
          type="text"
          placeholder="e.g. modify-gov"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          autoFocus
        />

        {validationError && (
          <div className="workspace-input-error">{validationError}</div>
        )}

        <div className="workspace-selector-buttons">
          <button
            className="workspace-create-btn"
            disabled={!!validationError}
            onClick={() => !validationError && onSelect(newName.trim())}
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
      </div>
    </div>
  );
}
