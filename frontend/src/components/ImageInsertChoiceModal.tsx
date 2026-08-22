/* frontend/src/components/ImageInsertChoiceModal.tsx
 *
 * Description of responsibility:
 *   The small modal shown right after the Images toolbar's Insert
 *   drop-position is picked (see App.tsx's pendingInsertPick flow) —
 *   lets the user choose between uploading a brand new image or
 *   reusing one that already exists somewhere in the workspace.
 */
interface ImageInsertChoiceModalProps {
  onNewImage: () => void;
  onChooseExisting: () => void;
  onCancel: () => void;
}

export function ImageInsertChoiceModal({
  onNewImage,
  onChooseExisting,
  onCancel,
}: ImageInsertChoiceModalProps) {
  return (
    <div className="edit-modal-overlay">
      <div className="edit-modal-box">
        <h3>Insert image</h3>
        <p>Upload a new image, or reuse one already in the project?</p>

        <div className="edit-modal-buttons" style={{ marginTop: "1rem" }}>
          <button type="button" onClick={onNewImage}>
            New image
          </button>
          <button type="button" onClick={onChooseExisting}>
            Choose image
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
