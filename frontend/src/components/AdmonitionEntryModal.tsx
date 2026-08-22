/* frontend/src/components/AdmonitionEntryModal.tsx
 *
 * Description of responsibility:
 *   The entry form for both Insert and Modify in the Admonitions
 *   toolbar — type selector, optional custom title, and the body text
 *   — shared between them since Modify is really just Insert pre-filled
 *   with an existing block's current values.
 */
import { useState } from "react";
import { ADMONITION_TYPES, ADMONITION_COLORS } from "../utils/admonitions";

interface AdmonitionEntryModalProps {
  initial?: { type: string; title: string; body: string };
  onSubmit: (data: { type: string; title: string; body: string }) => void;
  onCancel: () => void;
}

export function AdmonitionEntryModal({
  initial,
  onSubmit,
  onCancel,
}: AdmonitionEntryModalProps) {
  const [type, setType] = useState(initial?.type || "note");
  const [title, setTitle] = useState(initial?.title || "");
  const [body, setBody] = useState(initial?.body || "");

  const isModify = !!initial;

  return (
    <div className="edit-modal-overlay">
      <div className="edit-modal-box admonition-entry-box">
        <h3>{isModify ? "Modify admonition" : "Insert admonition"}</h3>

        <label className="admonition-entry-label">
          Type
          <div className="admonition-type-picker">
            {ADMONITION_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={`admonition-type-chip${type === t ? " active" : ""}`}
                onClick={() => setType(t)}
              >
                <span
                  className="admonition-type-swatch"
                  style={{ background: ADMONITION_COLORS[t] }}
                />
                {t}
              </button>
            ))}
          </div>
        </label>

        <label className="admonition-entry-label">
          Custom title (optional)
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`e.g. "Before you start" — leave blank for the default "${type}" title`}
          />
        </label>

        <label className="admonition-entry-label">
          Text
          <textarea
            className="admonition-entry-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="The admonition's content…"
            rows={5}
            autoFocus
          />
        </label>

        <div className="edit-modal-buttons" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            disabled={!body.trim()}
            onClick={() => onSubmit({ type, title: title.trim(), body })}
          >
            {isModify ? "Save" : "Insert"}
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
