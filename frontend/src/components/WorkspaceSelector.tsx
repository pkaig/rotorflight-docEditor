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

  const [validationError, setValidationError] = useState<string | null>(null);

  // NEW: upstream freshness state
  const [checkingUpstream, setCheckingUpstream] = useState(false);
  const [upstreamStale, setUpstreamStale] = useState(false);
  const [cloning, setCloning] = useState(false);

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
  // NEW: check upstream freshness when modal opens
  //
  useEffect(() => {
    if (!loading) {
      setCheckingUpstream(true);
      setUpstreamStale(false);
      setCloning(false);
      if (!login) return;

      fetch(
        `/api/reset-mirror/upstream-status?login=${encodeURIComponent(login)}`,
      )
        .then((r) => r.json())
        .then(async (data) => {
          if (data.stale) {
            setUpstreamStale(true);
            setCloning(true);

            // Trigger mirror refresh
            await fetch(
              `/api/reset-mirror?login=${encodeURIComponent(login)}`,
              { method: "POST" },
            );

            // ⭐ Reset stale indicator after clone completes
            setUpstreamStale(false);
          }
        })
        .finally(() => {
          setCheckingUpstream(false);
          setCloning(false);
        });
    }
  }, [loading, login]);

  //
  // Validate workspace name
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
      if (e.key === "Enter" && !validationError && !cloning) {
        onSelect(newName.trim());
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [newName, validationError, cloning, onSelect]);

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

        {checkingUpstream && (
          <div className="workspace-banner info">Checking upstream status…</div>
        )}

        {upstreamStale && (
          <div className="workspace-banner warning">
            Changes detected — cloning Rotorflight-docs…
          </div>
        )}

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
            disabled={!!validationError || cloning}
            onClick={() =>
              !validationError && !cloning && onSelect(newName.trim())
            }
          >
            {cloning ? "Preparing…" : "Create Workspace"}
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
