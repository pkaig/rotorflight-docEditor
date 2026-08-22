/* frontend/src/components/TableEntryModal.tsx
 *
 * Description of responsibility:
 *   The entry form for both Insert and Modify in the Table toolbar — an
 *   editable grid (header row + body rows, add/remove either), mirroring
 *   AdmonitionEntryModal's shared insert/modify shape: Modify is really
 *   just Insert pre-filled with an existing table's current values.
 */
import { useState } from "react";

interface TableEntryModalProps {
  initial?: { headers: string[]; rows: string[][] };
  onSubmit: (data: { headers: string[]; rows: string[][] }) => void;
  onCancel: () => void;
}

export function TableEntryModal({
  initial,
  onSubmit,
  onCancel,
}: TableEntryModalProps) {
  const [headers, setHeaders] = useState<string[]>(
    initial?.headers || ["Column 1", "Column 2"],
  );
  const [rows, setRows] = useState<string[][]>(
    initial?.rows || [["", ""]],
  );

  const isModify = !!initial;

  function updateHeader(i: number, value: string) {
    setHeaders((prev) => prev.map((h, idx) => (idx === i ? value : h)));
  }

  function updateCell(rowIdx: number, colIdx: number, value: string) {
    setRows((prev) =>
      prev.map((r, ri) =>
        ri === rowIdx ? r.map((c, ci) => (ci === colIdx ? value : c)) : r,
      ),
    );
  }

  function addColumn() {
    setHeaders((prev) => [...prev, `Column ${prev.length + 1}`]);
    setRows((prev) => prev.map((r) => [...r, ""]));
  }

  function removeColumn(i: number) {
    if (headers.length <= 1) return;
    setHeaders((prev) => prev.filter((_, idx) => idx !== i));
    setRows((prev) => prev.map((r) => r.filter((_, idx) => idx !== i)));
  }

  function addRow() {
    setRows((prev) => [...prev, headers.map(() => "")]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  const canSubmit = headers.every((h) => h.trim().length > 0);

  return (
    <div className="edit-modal-overlay">
      <div className="edit-modal-box table-entry-box">
        <h3>{isModify ? "Modify table" : "Insert table"}</h3>

        <div className="table-entry-grid-wrap">
          <table className="table-entry-grid">
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th key={i}>
                    <input
                      value={h}
                      onChange={(e) => updateHeader(i, e.target.value)}
                      placeholder={`Column ${i + 1}`}
                    />
                    <button
                      type="button"
                      className="table-entry-remove-btn"
                      onClick={() => removeColumn(i)}
                      disabled={headers.length <= 1}
                      title="Remove column"
                    >
                      ×
                    </button>
                  </th>
                ))}
                <th className="table-entry-add-cell">
                  <button
                    type="button"
                    onClick={addColumn}
                    title="Add column"
                  >
                    +
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>
                      <input
                        value={cell}
                        onChange={(e) => updateCell(ri, ci, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="table-entry-row-actions">
                    <button
                      type="button"
                      className="table-entry-remove-btn"
                      onClick={() => removeRow(ri)}
                      disabled={rows.length <= 1}
                      title="Remove row"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="button" className="table-entry-add-row" onClick={addRow}>
          + Add row
        </button>

        <div className="edit-modal-buttons" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit({ headers, rows })}
          >
            {isModify ? "Save" : "Insert"}
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
