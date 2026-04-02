// EditorPanel.tsx
import React from "react";

export const EditorPanel = React.memo(function EditorPanel({
  content,
  setContent,
  currentDocPath,
  conflict,
  errorLine,
  saveState,
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
}) {
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

      <h3>{conflict ? "Resolve Conflict" : "Editor"}</h3>

      {/* EDITOR BODY */}
      {conflict ? (
        <ConflictResolver
          workspace={workspace}
          file={currentDocPath.split("/").pop()}
          onMergedChange={(text) => setContent(text)}
          onResolved={async () => {
            await refreshLocalWorkspace(workspace);
            onSelect(workspace, currentDocPath);
          }}
        />
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{
            flex: 1,
            width: "100%",
            minHeight: 0,
            fontFamily: "monospace",
            fontSize: "14px",
            padding: "1rem",
            border: "1px solid #ccc",
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

            <p>Enter a file name (without extension):</p>

            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="my-new-page"
              style={{ width: "100%", marginTop: "0.5rem" }}
            />

            <div className="edit-modal-buttons" style={{ marginTop: "1rem" }}>
              <button
                onClick={async () => {
                  const safe = newFileName.trim().replace(/\s+/g, "-");
                  if (!safe || !newFileFolder) return;

                  const wsMatch = newFileFolder.match(
                    /^local-workspace\/([^/]+)\//,
                  );
                  const ws = wsMatch ? wsMatch[1] : null;
                  if (!ws) return;

                  const newPath = `${newFileFolder}/${safe}.mdx`;

                  setContent(newDocTemplate);
                  notifyFileCreated("local-workspace", newPath);
                  setShowNewFileModal(false);
                  setNewFileFolder(null);

                  await refreshLocalWorkspace(ws);
                  onSelect(ws, newPath);
                }}
              >
                Create
              </button>

              <button
                onClick={() => {
                  setShowNewFileModal(false);
                  setNewFileFolder(null);
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
