import { useEffect, useState } from "react";

type Status = "checking" | "idle" | "rebasing" | "done";

export function PRDescriptionModal({
  isOpen,
  onSubmit,
  onCancel,
  login,
  workspace,
  onConflictsDetected, // NEW callback
}) {
  const [description, setDescription] = useState("");
  // Single status drives the banner instead of three independently-set
  // booleans — the old version set "stale" true when the pre-submit check
  // started and never reset it, so the "rebasing workspace…" message stayed
  // on screen forever even once the (~15s) rebase had long finished and the
  // modal was actually usable underneath.
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    if (!isOpen) return;

    setDescription("");
    setStatus("checking");

    let cancelled = false;

    (async () => {
      try {
        const data = await fetch(
          `/api/docs/workspace-upstream-status?login=${encodeURIComponent(
            login,
          )}&workspace=${encodeURIComponent(workspace)}`,
        ).then((r) => r.json());

        if (cancelled) return;

        if (!data.stale) {
          setStatus("idle");
          return;
        }

        setStatus("rebasing");

        const reb = await fetch(
          `/api/reset-mirror/rebase-all-workspace?login=${encodeURIComponent(
            login,
          )}&workspace=${encodeURIComponent(workspace)}`,
          { method: "POST" },
        ).then((r) => r.json());

        if (cancelled) return;

        if (reb.result?.conflicts?.length > 0) {
          onConflictsDetected(reb.result.conflicts);
        }

        setStatus("done");
      } catch (err) {
        console.error("Upstream check/rebase failed:", err);
        // Fail open: don't block submitting just because the optional
        // pre-check itself errored.
        if (!cancelled) setStatus("idle");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, login, workspace, onConflictsDetected]);

  if (!isOpen) return null;

  const busy = status === "checking" || status === "rebasing";

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Enter description</h3>

        {status === "checking" && (
          <div className="modal-banner info">
            <Spinner /> Checking upstream status…
          </div>
        )}

        {status === "rebasing" && (
          <div className="modal-banner info">
            <Spinner /> Upstream changed — applying updates to your workspace…
          </div>
        )}

        {status === "done" && (
          <div className="modal-banner success">Workspace updated to match upstream.</div>
        )}

        <textarea
          className="modal-textarea"
          placeholder="Describe your changes"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="modal-buttons">
          <button
            className="modal-submit"
            disabled={busy}
            onClick={() => onSubmit(description.concat(" ", "-(docEditor)"))}
          >
            {status === "rebasing" ? "Rebasing…" : "Submit"}
          </button>

          <button className="modal-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="loading-icon" width="14" height="14" viewBox="0 0 24 24">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="56"
        strokeDashoffset="28"
        strokeLinecap="round"
      />
    </svg>
  );
}
