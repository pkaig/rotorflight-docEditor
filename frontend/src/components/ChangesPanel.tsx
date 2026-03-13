export function ChangesPanel({ changes }) {
  return (
    <div className="changes-panel">
      <h4>Changes</h4>

      {changes.added.map((c) => (
        <div key={c.path}>+ {c.path}</div>
      ))}

      {changes.modified.map((c) => (
        <div key={c.path}>• {c.path}</div>
      ))}

      {changes.deleted.map((c) => (
        <div key={c.path}>– {c.path}</div>
      ))}

      {changes.renamed.map((c) => (
        <div key={c.path}>
          ↪ {c.from} → {c.path}
        </div>
      ))}
    </div>
  );
}
