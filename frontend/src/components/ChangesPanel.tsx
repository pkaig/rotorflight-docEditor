export function ChangesPanel({
  changes,
  selectedChanges,
  setSelectedChanges,
  onOpenFile, // ← NEW
}) {
  function toggle(path) {
    setSelectedChanges((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  }

  function Row({ prefix, path, label }) {
    return (
      <div
        className="change-row"
        onClick={() => onOpenFile(path)} // ← open file on click
      >
        <label className="change-item">
          <input
            type="checkbox"
            checked={!!selectedChanges[path]}
            onChange={() => toggle(path)}
            onClick={(e) => e.stopPropagation()} // ← prevent checkbox click from opening file
          />
          <span>
            {prefix} {label}
          </span>
        </label>
      </div>
    );
  }

  return (
    <div className="changes-panel">
      <h4>Changes</h4>

      {changes.added.map((c) => (
        <Row key={c.path} prefix="+" path={c.path} label={c.path} />
      ))}

      {changes.modified.map((c) => (
        <Row key={c.path} prefix="•" path={c.path} label={c.path} />
      ))}

      {changes.deleted.map((c) => (
        <Row key={c.path} prefix="–" path={c.path} label={c.path} />
      ))}

      {changes.renamed.map((c) => (
        <Row
          key={c.path}
          prefix="↪"
          path={c.path}
          label={`${c.from} → ${c.path}`}
        />
      ))}
    </div>
  );
}
