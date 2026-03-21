export function ChangesPanel({ changes, selectedChanges, setSelectedChanges }) {
  function toggle(path) {
    setSelectedChanges((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  }

  return (
    <div className="changes-panel">
      <h4>Changes</h4>

      {changes.added.map((c) => (
        <label key={c.path} className="change-item">
          <input
            type="checkbox"
            checked={!!selectedChanges[c.path]}
            onChange={() => toggle(c.path)}
          />
          <span>+ {c.path}</span>
        </label>
      ))}

      {changes.modified.map((c) => (
        <label key={c.path} className="change-item">
          <input
            type="checkbox"
            checked={!!selectedChanges[c.path]}
            onChange={() => toggle(c.path)}
          />
          <span>• {c.path}</span>
        </label>
      ))}

      {changes.deleted.map((c) => (
        <label key={c.path} className="change-item">
          <input
            type="checkbox"
            checked={!!selectedChanges[c.path]}
            onChange={() => toggle(c.path)}
          />
          <span>– {c.path}</span>
        </label>
      ))}

      {changes.renamed.map((c) => (
        <label key={c.path} className="change-item">
          <input
            type="checkbox"
            checked={!!selectedChanges[c.path]}
            onChange={() => toggle(c.path)}
          />
          <span>
            ↪ {c.from} → {c.path}
          </span>
        </label>
      ))}
    </div>
  );
}
