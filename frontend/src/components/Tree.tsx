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
}

export function Tree({
  nodes,
  onSelect,
  onFolderClick,
  onDropFolder,
  setDraggedItem,
  openFolders,
  setOpenFolders,
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
                    (node.isWorkspaceRoot ? " workspace-root" : "")
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
                  {node.name}
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
                  />
                )}
              </div>
            ) : (
              <button
                className="tree-node file"
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
