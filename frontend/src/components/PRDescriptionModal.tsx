import React, { useState, useEffect } from "react";

export function PRDescriptionModal({
  isOpen,
  onSubmit,
  onCancel,
  login,
  workspace,
  onConflictsDetected, // NEW callback
}) {
  const [description, setDescription] = useState("");
  const [checking, setChecking] = useState(false);
  const [stale, setStale] = useState(false);
  const [rebasing, setRebasing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDescription("");
      setChecking(true);
      setStale(false);
      setRebasing(false);

      // 🔍 Check if workspace is stale relative to upstream
      fetch(
        `/api/docs/workspace-upstream-status?login=${encodeURIComponent(
          login,
        )}&workspace=${encodeURIComponent(workspace)}`,
      )
        .then((r) => r.json())
        .then(async (data) => {
          if (data.stale) {
            setStale(true);
            setRebasing(true);

            // 🔧 Trigger backend rebase
            const reb = await fetch(
              `/api/reset-mirror/rebase-all-workspace?login=${encodeURIComponent(
                login,
              )}&workspace=${encodeURIComponent(workspace)}`,
              { method: "POST" },
            ).then((r) => r.json());

            setRebasing(false);

            // ⚠️ If conflicts exist → open conflict resolver
            if (reb.result?.conflicts?.length > 0) {
              onConflictsDetected(reb.result.conflicts);
            }
          }
        })
        .finally(() => setChecking(false));
    }
  }, [isOpen, login, workspace, onConflictsDetected]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Enter description</h3>

        {checking && (
          <div className="modal-banner info">Checking upstream status…</div>
        )}

        {stale && !checking && (
          <div className="modal-banner warning">
            Upstream changed — rebasing workspace…
          </div>
        )}

        {rebasing && (
          <div className="modal-banner info">Applying upstream changes…</div>
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
            disabled={checking || rebasing}
            onClick={() => onSubmit(description.concat(" ", "-(docEditor)"))}
          >
            {rebasing ? "Rebasing…" : "Submit"}
          </button>

          <button className="modal-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
