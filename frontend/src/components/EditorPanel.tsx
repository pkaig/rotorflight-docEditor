/* frontend/src/components/EditorPanel.tsx
 *
 * Description of responsibility:
 *   The main document editor surface: renders the spell-checked
 *   textarea (or ConflictResolver, when the open file has an
 *   unresolved conflict) and owns the "create new page" modal,
 *   including slugging the entered name into a safe filename and
 *   seeding new pages with a worked image-usage example when the
 *   target folder has an img/ subfolder.
 *
 * Info:
 *   slugifyFileName() also guards against path traversal (collapsing
 *   "." runs) even though the backend independently validates the path
 *   too. buildNewFileContent() inserts the image import after the
 *   template's frontmatter block specifically — an import placed before
 *   a leading "---" frontmatter fence breaks MDX parsing. The
 *   textarea's error-line highlight background is computed here from
 *   the `errorLine` prop that flows down from Preview's compile errors
 *   via App.tsx.
 */
// EditorPanel.tsx
import React, { useState } from "react";
import { SpellcheckTextarea } from "./SpellcheckTextarea";
import ConflictResolver from "./ConflictResolver";
import { slugifyFileName } from "../utils/slugifyFileName";

// Seeds new pages that already have an img/ folder with a worked example of
// how to actually use an image, rather than leaving people to guess the
// import + JSX pattern from scratch. The import has to land after the
// frontmatter block (imports before "---" would break it), so this splits
// on the template's own leading frontmatter rather than just prepending.
function buildNewFileContent(
  template: string,
  imageName: string | null,
): string {
  if (!imageName) return template;

  const importLine = `import testImage from "./img/${imageName}";\n`;
  const exampleSection = `
# Example image

This is how to use an image.
1. add to the img folder then
2. import it at the top of the file like this:  
   - import testImage from "./img/-your-image-file-"; then
3. use it in the file like this:

<div style={{ textAlign: 'center' }}>
  <img src={testImage} style={{ width: '70%', borderRadius: '10px' }} />
</div>
`;

  const frontmatterMatch = template.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!frontmatterMatch) {
    return importLine + "\n" + template + exampleSection;
  }

  const end = frontmatterMatch[0].length;
  return (
    template.slice(0, end) +
    "\n" +
    importLine +
    template.slice(end) +
    exampleSection
  );
}

interface EditorPanelProps {
  content: string;
  setContent: React.Dispatch<React.SetStateAction<string>>;
  currentDocPath: string;
  conflict: boolean;
  errorLine: number | null;
  saveState: "idle" | "saving" | "saved" | "error";
  login: string | null;
  workspace: string | null;
  refreshLocalWorkspace: (ws: string) => Promise<unknown>;
  onSelect: (ws: string, path: string) => Promise<void> | void;

  // modal props
  showNewFileModal: boolean;
  setShowNewFileModal: React.Dispatch<React.SetStateAction<boolean>>;
  newFileName: string;
  setNewFileName: React.Dispatch<React.SetStateAction<string>>;
  newFileFolder: string | null;
  setNewFileFolder: React.Dispatch<React.SetStateAction<string | null>>;
  notifyFileCreated: (
    slug: string,
    path: string,
    content: string,
  ) => Promise<{ ok: boolean; error?: string } | undefined>;
  newDocTemplate: string;
  newFileImageName: string | null;
  // Forwarded straight through to the underlying <textarea> — the
  // editor/preview scroll-sync hook (owned by App.tsx, a sibling of this
  // component) needs the real DOM node to read/drive scrollTop and to
  // measure image-line pixel offsets against.
  textareaRef?: React.Ref<HTMLTextAreaElement>;
}

export const EditorPanel = React.memo(function EditorPanel({
  content,
  setContent,
  currentDocPath,
  conflict,
  errorLine,
  saveState,
  login,
  workspace,
  refreshLocalWorkspace,
  onSelect,

  // modal props
  showNewFileModal,
  setShowNewFileModal,
  newFileName,
  setNewFileName,
  newFileFolder,
  setNewFileFolder,
  notifyFileCreated,
  newDocTemplate,
  newFileImageName,
  textareaRef,
}: EditorPanelProps) {
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  return (
    <div
      className="editor-container"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        position: "relative",
      }}
    >
      {/* SAVE INDICATOR */}
      {saveState !== "idle" && (
        <div className={`save-indicator ${saveState}`}>
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && "Saved"}
          {saveState === "error" && "Save failed"}
        </div>
      )}

      {conflict && <h3>Resolve Conflict</h3>}

      {/* EDITOR BODY */}
      {conflict && workspace ? (
        <ConflictResolver
          workspace={workspace}
          file={currentDocPath.split("/").pop() ?? ""}
          login={login}
          onMergedChange={(text) => setContent(text)}
          onClose={() => onSelect(workspace, currentDocPath)}
          onResolved={async () => {
            await refreshLocalWorkspace(workspace);
            onSelect(workspace, currentDocPath);
          }}
        />
      ) : (
        <SpellcheckTextarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          login={login}
          workspace={workspace}
          style={{
            // Explicit font, not the generic "monospace" keyword: some
            // browsers resolve generic font families to a different actual
            // font for form controls (<textarea>) than for regular
            // elements (<div>), which would make the backdrop and textarea
            // render glyphs at very slightly different widths and drift
            // out of alignment over a long document.
            fontFamily: "Consolas, 'Courier New', monospace",
            fontSize: "14px",
            padding: "1rem",
            border: "1px solid #ddd",
            borderRadius: 4,
            background:
              errorLine !== null
                ? `linear-gradient(
                    to bottom,
                    transparent ${(errorLine - 1) * 1.4}rem,
                    #ffe6e6 ${(errorLine - 1) * 1.4}rem,
                    #ffe6e6 ${errorLine * 1.4}rem,
                    transparent ${errorLine * 1.4}rem
                  )`
                : "white",
          }}
        />
      )}

      {/* NEW FILE MODAL */}
      {showNewFileModal && (
        <div className="edit-modal-overlay">
          <div className="edit-modal-box">
            <h3>Create new page</h3>

            <p>Enter a file name:</p>

            <input
              type="text"
              value={newFileName}
              onChange={(e) => {
                setNewFileName(e.target.value);
                setCreateError(null);
              }}
              placeholder="My New Page"
              autoFocus
              style={{ width: "100%", marginTop: "0.5rem" }}
            />

            <p
              style={{
                fontSize: "0.85rem",
                color: "#666",
                marginTop: "0.4rem",
              }}
            >
              Will be created as{" "}
              <code>{slugifyFileName(newFileName) || "…"}.mdx</code>
            </p>

            {newFileImageName && (
              <p style={{ fontSize: "0.85rem", color: "#666" }}>
                Includes a worked example using{" "}
                <code>img/{newFileImageName}</code>.
              </p>
            )}

            {createError && (
              <p style={{ fontSize: "0.85rem", color: "#c0392b" }}>
                {createError}
              </p>
            )}

            <div className="edit-modal-buttons" style={{ marginTop: "1rem" }}>
              <button
                disabled={creating}
                onClick={async () => {
                  const safe = slugifyFileName(newFileName);
                  if (!safe || !newFileFolder) {
                    setCreateError("Enter a name for the page.");
                    return;
                  }

                  const wsMatch = newFileFolder.match(
                    /^local-workspace\/([^/]+)\//,
                  );
                  const ws = wsMatch ? wsMatch[1] : null;
                  if (!ws) return;

                  const newPath = `${newFileFolder}/${safe}.mdx`;
                  const initialContent = buildNewFileContent(
                    newDocTemplate,
                    newFileImageName,
                  );

                  setCreating(true);
                  setCreateError(null);

                  const result = await notifyFileCreated(
                    "local-workspace",
                    newPath,
                    initialContent,
                  );

                  setCreating(false);

                  if (!result?.ok) {
                    setCreateError(result?.error || "Failed to create file.");
                    return;
                  }

                  setShowNewFileModal(false);
                  setNewFileFolder(null);
                  setNewFileName("");
                  setContent(initialContent);

                  await refreshLocalWorkspace(ws);
                  onSelect(ws, newPath);
                }}
              >
                {creating ? "Creating…" : "Create"}
              </button>

              <button
                disabled={creating}
                onClick={() => {
                  setShowNewFileModal(false);
                  setNewFileFolder(null);
                  setNewFileName("");
                  setCreateError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
