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
  // page inside it.
  onNewFile?: (folderPath: string) => void;
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
      {safeNodes.map((node, index) => {
        // console.log("TREE NODE", index, node);
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
                  {!node.isWorkspaceRoot && <span className="tree-chevron" aria-hidden="true" />}
                  {!node.isWorkspaceRoot && onNewFile && (
                    <button
                      type="button"
                      className="tree-new-file-btn"
                      title="New page in this folder"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (node.path) onNewFile(node.path);
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
                  />
                )}
              </div>
            ) : (
              <button
                className={
                  "tree-node file" +
                  (node.path && node.path === currentPath ? " active" : "")
                }
                draggable
                onDragStart={() => node.path && setDraggedItem(node.path)}
                onClick={() => node.path && onSelect(node.path)}
              >
                {node.name}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
