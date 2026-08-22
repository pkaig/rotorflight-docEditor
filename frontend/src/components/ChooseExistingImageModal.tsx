/* frontend/src/components/ChooseExistingImageModal.tsx
 *
 * Description of responsibility:
 *   The "Choose image" half of the Insert flow's picker (see
 *   ImageInsertChoiceModal) — browses every image already in the
 *   current workspace (not just the open doc's own img/ folder) as a
 *   searchable thumbnail grid, and hands back the chosen one's full
 *   virtual path so the caller can compute a relative path from the
 *   open doc to it.
 *
 * Info:
 *   Click-to-select-then-confirm rather than committing on the first
 *   click — a grid of same-sized thumbnails is easy to misclick, so a
 *   separate "Use image" step (disabled until something's selected)
 *   gives a chance to notice the wrong one got highlighted before it's
 *   actually inserted. The disabled state relies on
 *   .edit-modal-buttons button:disabled actually looking different from
 *   enabled — worth double-checking after any change to that shared
 *   rule, since a disabled button that's visually identical to an
 *   enabled one is exactly what made this step look broken before.
 */
import { useMemo, useState } from "react";

interface ExistingImage {
  name: string;
  path: string; // full virtual path, e.g. "local-workspace/<ws>/docs/tuning/img/photo.png"
}

interface ChooseExistingImageModalProps {
  images: ExistingImage[];
  login: string | null;
  workspace: string | null;
  onChoose: (image: ExistingImage) => void;
  onCancel: () => void;
}

export function ChooseExistingImageModal({
  images,
  login,
  workspace,
  onChoose,
  onCancel,
}: ChooseExistingImageModalProps) {
  const [selected, setSelected] = useState<ExistingImage | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return images;
    return images.filter(
      (img) =>
        img.name.toLowerCase().includes(q) ||
        img.path.toLowerCase().includes(q),
    );
  }, [images, search]);

  return (
    <div className="edit-modal-overlay">
      <div className="edit-modal-box choose-existing-image-box">
        <h3>Choose an existing image</h3>

        {images.length === 0 ? (
          <p>No images found anywhere in this workspace yet.</p>
        ) : (
          <>
            <input
              type="text"
              className="choose-existing-image-search"
              placeholder="Search images…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />

            {filtered.length === 0 ? (
              <p>No images match "{search}".</p>
            ) : (
              <div className="choose-existing-image-grid">
                {filtered.map((img) => {
                  // The backend's /images/local route parses `path` as
                  // "local-workspace/<ws>/<rest>" itself (see
                  // docsRoutes.ts) — it needs that prefix kept, not
                  // stripped, matching how rehypeImagesPlugin.ts builds
                  // this exact same URL for the preview's own rendered
                  // <img> tags.
                  const params = new URLSearchParams({
                    path: img.path,
                    login: login || "",
                    workspace: workspace || "",
                  });
                  const thumbUrl = `/api/docs/images/local?${params.toString()}`;
                  const isSelected = selected?.path === img.path;

                  return (
                    <button
                      key={img.path}
                      type="button"
                      className={`choose-existing-image-item${isSelected ? " selected" : ""}`}
                      title={img.path}
                      onClick={() => setSelected(img)}
                    >
                      {isSelected && (
                        <span className="choose-existing-image-check">✓</span>
                      )}
                      <img src={thumbUrl} alt={img.name} loading="lazy" />
                      <span>{img.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        <div className="edit-modal-buttons" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            disabled={!selected}
            onClick={() => selected && onChoose(selected)}
          >
            Use image
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
