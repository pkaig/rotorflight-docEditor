// PRDescriptionModal.tsx

import React, { useState, useEffect } from "react";

export function PRDescriptionModal({ isOpen, onSubmit, onCancel }) {
  const [description, setDescription] = useState("");

  // Reset description every time the modal opens
  useEffect(() => {
    if (isOpen) {
      setDescription("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Enter description</h3>

        <textarea
          className="modal-textarea"
          placeholder="Describe your changes"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="modal-buttons">
          <button
            className="modal-submit"
            onClick={() => onSubmit(description.concat(" ", "-(docEditor)"))}
          >
            Submit
          </button>

          <button className="modal-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
