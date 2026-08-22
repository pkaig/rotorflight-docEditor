/* frontend/src/components/TabsEntryModal.tsx
 *
 * Description of responsibility:
 *   The entry form for both Insert and Modify in the Tabs toolbar — a
 *   list of {label, content} tabs with add/remove, mirroring
 *   AdmonitionEntryModal/TableEntryModal's shared insert/modify shape.
 *   Each tab's `value` (the JSX attribute Docusaurus actually keys on)
 *   is derived from its label rather than exposed as its own field —
 *   same reasoning as slugifyFileName elsewhere in this app: the
 *   user-facing label is what matters, the machine identifier is
 *   plumbing they shouldn't have to think about.
 */
import { useState } from "react";

interface TabEntry {
  label: string;
  content: string;
}

interface TabsEntryModalProps {
  initial?: TabEntry[];
  onSubmit: (tabs: TabEntry[]) => void;
  onCancel: () => void;
}

export function TabsEntryModal({
  initial,
  onSubmit,
  onCancel,
}: TabsEntryModalProps) {
  const [tabs, setTabs] = useState<TabEntry[]>(
    initial && initial.length > 0
      ? initial
      : [
          { label: "Tab 1", content: "" },
          { label: "Tab 2", content: "" },
        ],
  );

  const isModify = !!initial;

  function updateLabel(i: number, value: string) {
    setTabs((prev) => prev.map((t, idx) => (idx === i ? { ...t, label: value } : t)));
  }

  function updateContent(i: number, value: string) {
    setTabs((prev) =>
      prev.map((t, idx) => (idx === i ? { ...t, content: value } : t)),
    );
  }

  function addTab() {
    setTabs((prev) => [...prev, { label: `Tab ${prev.length + 1}`, content: "" }]);
  }

  function removeTab(i: number) {
    if (tabs.length <= 1) return;
    setTabs((prev) => prev.filter((_, idx) => idx !== i));
  }

  const canSubmit = tabs.every((t) => t.label.trim().length > 0);

  return (
    <div className="edit-modal-overlay">
      <div className="edit-modal-box tabs-entry-box">
        <h3>{isModify ? "Modify tabs" : "Insert tabs"}</h3>
        <p className="tabs-entry-note">
          Tabs are JSX — this doc needs to be .mdx for them to render on the
          real site.
        </p>

        <div className="tabs-entry-list">
          {tabs.map((t, i) => (
            <div className="tabs-entry-tab" key={i}>
              <div className="tabs-entry-tab-header">
                <input
                  value={t.label}
                  onChange={(e) => updateLabel(i, e.target.value)}
                  placeholder={`Tab ${i + 1} label`}
                />
                <button
                  type="button"
                  className="table-entry-remove-btn"
                  onClick={() => removeTab(i)}
                  disabled={tabs.length <= 1}
                  title="Remove tab"
                >
                  ×
                </button>
              </div>
              <textarea
                value={t.content}
                onChange={(e) => updateContent(i, e.target.value)}
                placeholder="This tab's content…"
                rows={4}
              />
            </div>
          ))}
        </div>

        <button type="button" className="table-entry-add-row" onClick={addTab}>
          + Add tab
        </button>

        <div className="edit-modal-buttons" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit(tabs)}
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
