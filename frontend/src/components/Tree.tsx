/* frontend/src/components/Tree.tsx
 *
 * Description of responsibility:
 *   Recursive sidebar file/folder tree — renders a workspace's doc
 *   structure, handles expand/collapse, drag-and-drop file moves, the
 *   "new page" (+) button per folder, and highlights the
 *   currently-open file.
 *
 * Info:
 *   The workspace-root folder node never gets a chevron or a "+"
 *   button — it only ever contains docs/versioned_docs, not actual
 *   pages, so those controls would be meaningless there. currentPath
 *   comparison is a direct string match against node.path because both
 *   use the same "local-workspace/<ws>/..." canonical format, so no
 *   normalization step is needed.
 *
 *   The "+" button calls onNewImage instead of onNewFile specifically
 *   for a folder named "img" — img/ folders exist to hold images, not
 *   .mdx documents, so offering "new page" there was actively wrong
 *   (see AddImageModal.tsx for what onNewImage actually opens).
 */
import React from "react";

export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
  isWorkspaceRoot?: boolean;
};

interface TreeProps {
  nodes: TreeNode[];
  onSelect: (path: string) => void;
  onDropFolder: (path: string) => void;
  setDraggedItem: (path: string | null) => void;
  onFolderClick?: (path: string) => void;
  openFolders: Record<string, boolean>;
  setOpenFolders: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  // Highlights the file row matching this path (the doc currently open in
  // the editor) — currentDocPath is built from the same
  // "local-workspace/<ws>/..." format as node.path, so a direct match is
  // enough, no normalization needed.
  currentPath?: string;
  // Shows a "+" on each folder row (except the workspace root, which only
  // ever contains docs/versioned_docs, not actual pages) to create a new
  // page inside it — or, for a folder literally named "img", to add an
  // image instead (see onNewImage).
  onNewFile?: (folderPath: string) => void;
  onNewImage?: (folderPath: string) => void;
  // Shows a small delete button on each file row, mirroring onNewFile's
  // "+" on folder rows. Undefined omits the button entirely.
  onDeleteFile?: (path: string) => void;
  // Rendered next to the workspace-root node's own name only (e.g. a
  // "merged" badge — see App.tsx) — never passed down to the recursive
  // call below, since no other node is ever isWorkspaceRoot.
  rootBadge?: React.ReactNode;
}

export function Tree({
  nodes,
  onSelect,
  onFolderClick,
  onDropFolder,
  setDraggedItem,
  openFolders,
  setOpenFolders,
  currentPath,
  onNewFile,
  onNewImage,
  onDeleteFile,
  rootBadge,
}: TreeProps) {
  const safeNodes = Array.isArray(nodes) ? nodes : [];
  const folders = openFolders || {};

  function toggleFolder(path?: string) {
    if (!path) return;
    setOpenFolders((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  // console.log("NODES RECEIVED BY TREE:", nodes);

  return (
    <ul className="tree-list">
      {safeNodes.map((node) => {
        // console.log("TREE NODE", node);
        if (!node || typeof node !== "object") return null;

        // --- SAFETY: ensure key is always a string ---
        const key = (node.path ?? node.name).replace(/\/$/, "");

        return (
          <li key={key}>
            {node.type === "dir" ? (
              <div className="tree-dir">
                <div
                  className={
                    "tree-node " +
                    (node.type === "dir" ? "folder" : "file") +
                    (node.isWorkspaceRoot ? " workspace-root" : "") +
                    (node.path && folders[node.path] ? " open" : "")
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFolder(node.path);
                    if (onFolderClick) {
                      onFolderClick(node.path);
                    }
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => node.path && onDropFolder(node.path)}
                >
                  <span className="tree-node-name">{node.name}</span>
                  {node.isWorkspaceRoot && rootBadge}
                  {!node.isWorkspaceRoot && <span className="tree-chevron" aria-hidden="true" />}
                  {!node.isWorkspaceRoot &&
                    (node.name.toLowerCase() === "img" ? onNewImage : onNewFile) && (
                      <button
                        type="button"
                        className="tree-new-file-btn"
                        title={
                          node.name.toLowerCase() === "img"
                            ? "Add image to this folder"
                            : "New page in this folder"
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!node.path) return;
                          if (node.name.toLowerCase() === "img") {
                            onNewImage?.(node.path);
                          } else {
                            onNewFile?.(node.path);
                          }
                        }}
                      >
                        +
                      </button>
                    )}
                </div>

                {node.path && folders[node.path] && (
                  <Tree
                    nodes={node.children || []}
                    onSelect={onSelect}
                    onFolderClick={onFolderClick}
                    onDropFolder={onDropFolder}
                    setDraggedItem={setDraggedItem}
                    openFolders={folders}
                    setOpenFolders={setOpenFolders}
                    currentPath={currentPath}
                    onNewFile={onNewFile}
                    onNewImage={onNewImage}
                    onDeleteFile={onDeleteFile}
                  />
                )}
              </div>
            ) : (
              <div
                className={
                  "tree-node file" +
                  (node.path && node.path === currentPath ? " active" : "")
                }
                draggable
                onDragStart={() => node.path && setDraggedItem(node.path)}
              >
                <span
                  className="tree-node-name"
                  onClick={() => node.path && onSelect(node.path)}
                >
                  {node.name}
                </span>
                {onDeleteFile && (
                  <button
                    type="button"
                    className="tree-delete-file-btn"
                    title="Delete this file"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (node.path) onDeleteFile(node.path);
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
