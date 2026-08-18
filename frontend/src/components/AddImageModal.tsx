/* frontend/src/components/AddImageModal.tsx
 *
 * Description of responsibility:
 *   The modal opened by the sidebar's "+" button on an img/ folder
 *   specifically (see Tree.tsx / App.tsx's onNewImage) — lets the user
 *   get an image into that folder via click-to-browse, drag-and-drop, or
 *   pasting (e.g. a Snipping Tool capture), prompts for a name, and
 *   uploads it through the existing /api/docs/local/upload endpoint.
 *
 * Info:
 *   All three input methods converge on the same handleImageBlob() path,
 *   which is also why paste is captured via a window-level listener
 *   rather than an onPaste prop on the drop-zone: paste events only fire
 *   on the currently-focused element, and a plain <div> isn't reliably
 *   focused the instant the modal opens, so a window listener scoped to
 *   isOpen is more robust than relying on focus.
 *
 *   The extension is never taken from user input — it's derived from
 *   the actual image data (the source file's own extension if it has a
 *   recognized one, else its MIME type), since a pasted clipboard image
 *   typically has no meaningful filename at all (something like
 *   "image.png" or blank) for the extension to come from.
 */
import { useEffect, useRef, useState } from "react";
import { slugifyFileName } from "../utils/slugifyFileName";

interface AddImageModalProps {
  isOpen: boolean;
  folder: string | null; // full virtual path, e.g. "local-workspace/<ws>/docs/setup/img"
  login: string | null;
  onClose: () => void;
  onUploaded: (workspace: string) => void;
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function determineExtension(file: File | Blob): string {
  const name = "name" in file ? file.name : "";
  const match = name.match(/\.([a-z0-9]+)$/i);
  if (match && /^(png|jpe?g|gif|webp|svg)$/i.test(match[1])) {
    return match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  }
  return MIME_EXT[file.type] || "png";
}

export function AddImageModal({
  isOpen,
  folder,
  login,
  onClose,
  onUploaded,
}: AddImageModalProps) {
  const [name, setName] = useState("");
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imageExt, setImageExt] = useState("png");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const wsMatch = folder?.match(/^local-workspace\/([^/]+)\//);
  const ws = wsMatch ? wsMatch[1] : null;
  const relFolder = folder && ws ? folder.slice(`local-workspace/${ws}/`.length) : null;

  // Fresh state every time the modal opens, and release the previous
  // preview's object URL rather than leaking it.
  useEffect(() => {
    if (!isOpen) return;
    setName("");
    setImageBlob(null);
    setImageExt("png");
    setError(null);
    setDragOver(false);
    return () => {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [isOpen]);

  function handleImageBlob(blob: Blob, suggestedName?: string) {
    if (!blob.type.startsWith("image/")) {
      setError("That doesn't look like an image file.");
      return;
    }
    setError(null);
    setImageBlob(blob);
    setImageExt(determineExtension(blob));
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    if (suggestedName && !name) {
      setName(suggestedName.replace(/\.[a-z0-9]+$/i, ""));
    }
  }

  // Paste only fires on whatever element currently has focus, which a
  // freshly-opened modal's drop-zone <div> isn't guaranteed to be — a
  // window-level listener scoped to isOpen catches it regardless.
  useEffect(() => {
    if (!isOpen) return;

    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            handleImageBlob(blob);
          }
          return;
        }
      }
    }

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, name]);

  if (!isOpen) return null;

  async function handleUpload() {
    if (!imageBlob || !ws || !relFolder || !login) return;

    const safeName = slugifyFileName(name);
    if (!safeName) {
      setError("Enter a name for the image.");
      return;
    }

    const finalName = `${safeName}.${imageExt}`;
    const renamedFile = new File([imageBlob], finalName, {
      type: imageBlob.type,
    });

    const formData = new FormData();
    formData.append("folder", relFolder);
    formData.append("file", renamedFile);

    setUploading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/docs/local/upload?login=${encodeURIComponent(login)}&workspace=${encodeURIComponent(ws)}`,
        { method: "POST", body: formData },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Upload failed");
      }

      onUploaded(ws);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="edit-modal-overlay">
      <div className="edit-modal-box">
        <h3>Add image</h3>
        <p>Adding to: {relFolder}</p>

        <div
          className={`add-image-dropzone${dragOver ? " drag-over" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleImageBlob(file, file.name);
          }}
        >
          {previewUrl ? (
            <img src={previewUrl} alt="" className="add-image-preview" />
          ) : (
            <div className="add-image-dropzone-hint">
              Click to choose a file, drag one here, or paste (Ctrl+V)
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageBlob(file, file.name);
            e.target.value = "";
          }}
        />

        {imageBlob && (
          <>
            <p style={{ marginTop: "0.75rem" }}>Name:</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-diagram"
              autoFocus
              style={{ width: "100%" }}
            />
            <p
              style={{
                fontSize: "0.85rem",
                color: "#666",
                marginTop: "0.4rem",
              }}
            >
              Will be saved as{" "}
              <code>
                {slugifyFileName(name) || "…"}.{imageExt}
              </code>
            </p>
          </>
        )}

        {error && (
          <p style={{ fontSize: "0.85rem", color: "#c0392b" }}>{error}</p>
        )}

        <div className="edit-modal-buttons" style={{ marginTop: "1rem" }}>
          <button
            disabled={!imageBlob || uploading}
            onClick={handleUpload}
          >
            {uploading ? "Adding…" : "Add Image"}
          </button>
          <button disabled={uploading} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
