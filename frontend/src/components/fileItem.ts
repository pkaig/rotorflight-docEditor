import { isConflictFile } from "./conflictUtils";               

function FileItem({ file }) {
  const conflict = isConflictFile(file.name);

  return (
    <div
      className={`file-item ${conflict ? "conflict" : ""}`}
      onClick={() => openFile(file.path)}
    >
      {conflict && <span className="conflict-dot" />}
      {file.name}
    </div>
  );
}
