/* frontend/src/components/WorkspaceSelector.tsx
 *
 * Description of responsibility:
 *   Modal for creating a new workspace: validates the entered name,
 *   checks (and if needed triggers a refresh of) the global upstream
 *   mirror's freshness before letting the user proceed.
 *
 * Info:
 *   onSelect(null) is the modal's "cancelled" signal (both Escape and
 *   the Cancel button use it) — App.tsx's handler for this component
 *   treats a null workspace name as "just close the modal, don't
 *   actually create anything." Existing workspace names are fetched on
 *   mount but not currently rendered anywhere in this modal — the fetch
 *   looks like unfinished scaffolding for showing/avoiding duplicates,
 *   left as-is rather than removed or finished here.
 */
import { useEffect, useRef, useState } from "react";
import { validateWorkspaceName } from "../utils/validateWorkspaceName";
// Same cleanup rules as the "create new page" and "add image" modals: the
// input shows exactly what the user typed, and this only drives the "will
// be created as" preview + what's actually submitted — so typing "My Gov
// Tweaks" or "my_gov_tweaks" both land on the same "my-gov-tweaks" rather
// than being rejected outright for using spaces/underscores/uppercase.
import { slugifyFileName } from "../utils/slugifyFileName";
import { focusAppWindow } from "../utils/focusAppWindow";

interface WorkspaceSelectorProps {
  login: string | null;
  onSelect: (workspace: string | null) => void | Promise<void>;
}

export function WorkspaceSelector({ login, onSelect }: WorkspaceSelectorProps) {
  const [, setWorkspaces] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);

  const [validationError, setValidationError] = useState<string | null>(null);

  // NEW: upstream freshness state
  const [checkingUpstream, setCheckingUpstream] = useState(false);
  const [upstreamStale, setUpstreamStale] = useState(false);
  const [cloning, setCloning] = useState(false);

  // App.tsx's onSelect handler does the real work (POST /create-workspace,
  // a real git clone/fork setup that takes several seconds) before it
  // resolves — without tracking that here too, the button just sat there
  // looking idle for the whole call, since App.tsx's own "workspace
  // created" banner only appears once that call has basically finished.
  const [creating, setCreating] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // autoFocus/plain window.focus() weren't reliable here: this modal is
  // typically opened right after a window.confirm() dialog closes (e.g.
  // delete-workspace's confirm), and window.focus() from a renderer is a
  // request the OS is free to ignore (especially on Windows) — see
  // focusAppWindow's own header comment for the real fix (routing through
  // BrowserWindow.focus() in the main process instead). Still retries for
  // a few seconds and checks document.hasFocus(), since even the reliable
  // path can lose a narrow race against whatever just closed.
  useEffect(() => {
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;

    function tryFocus() {
      focusAppWindow();
      nameInputRef.current?.focus();
      attempts++;

      const focused =
        document.hasFocus() && document.activeElement === nameInputRef.current;
      if (focused || attempts >= 20) return;

      timer = setTimeout(tryFocus, 150);
    }

    tryFocus();
    return () => clearTimeout(timer);
  }, []);

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
      const currentLogin = login;

      fetch(
        `/api/reset-mirror/upstream-status?login=${encodeURIComponent(currentLogin)}`,
      )
        .then((r) => r.json())
        .then(async (data) => {
          if (data.stale) {
            setUpstreamStale(true);
            setCloning(true);

            // Trigger mirror refresh
            await fetch(
              `/api/reset-mirror?login=${encodeURIComponent(currentLogin)}`,
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

  // What actually gets validated/submitted — the raw input stays in
  // `newName` untouched so the user can keep typing naturally (spaces,
  // capitals, etc.) without characters getting silently eaten mid-word.
  const slug = slugifyFileName(newName);

  //
  // Validate workspace name
  //
  useEffect(() => {
    setValidationError(validateWorkspaceName(slug));
  }, [slug]);

  //
  // Keyboard shortcuts
  //
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onSelect(null);
      }
      if (e.key === "Enter" && !validationError && !cloning && !creating) {
        void submit();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [newName, validationError, cloning, creating, onSelect]);

  async function submit() {
    setCreating(true);
    try {
      await onSelect(slug);
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="workspace-selector-modal">
        <div className="workspace-selector-content">
          <h2>Loading workspaces…</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-selector-modal">
      <div className="workspace-selector-content">
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
          ref={nameInputRef}
          className={`workspace-input ${validationError ? "invalid" : ""}`}
          type="text"
          placeholder="e.g. Modify Gov"
          value={newName}
          onChange={(e) =>
            // Blocks real symbols/punctuation from ever landing in the
            // field — space/underscore stay typeable since slugifyFileName
            // turns those into the hyphen separators the naming scheme
            // (and every existing workspace: "gov-review", "xdfly-gov")
            // actually uses, rather than rejecting multi-word names outright.
            setNewName(e.target.value.replace(/[^a-zA-Z0-9 _-]/g, ""))
          }
        />

        <p className="workspace-name-preview">
          Will be created as <code>{slug || "…"}</code>
        </p>

        {validationError && (
          <div className="workspace-input-error">{validationError}</div>
        )}

        {creating && (
          <div className="workspace-banner info">Creating workspace…</div>
        )}

        <div className="workspace-selector-buttons">
          <button
            className="workspace-create-btn"
            disabled={!!validationError || cloning || creating}
            onClick={() => !validationError && !cloning && !creating && submit()}
          >
            {cloning ? "Preparing…" : creating ? "Creating…" : "Create Workspace"}
          </button>

          <button
            className="workspace-cancel-btn"
            disabled={creating}
            onClick={() => onSelect(null)}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
