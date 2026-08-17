import { useEffect, useRef, useState } from "react";
const AUTOSAVE_ENABLED = true;

export function useAutosave(
  login: string | null,
  workspace: string | null,
  filePath: string,
  content: string,
  suppressNextAutosave: boolean,
  setSuppressNextAutosave: (v: boolean) => void,
  saveDocument: (content: string) => Promise<void> | void,
) {
  const [saving, setSaving] = useState(false);
  const timeout = useRef<number | null>(null);

  useEffect(() => {
    // These used to be early returns before the hook calls above — fine
    // while AUTOSAVE_ENABLED and the content checks never actually trip
    // (they don't, today), but React requires the same hooks in the same
    // order on every render, so a future change to any of these
    // conditions would have been a real bug waiting to happen.
    if (!AUTOSAVE_ENABLED) return;
    if (content === undefined || content === null) return;
    if (typeof content !== "string") return;

    if (!login || !workspace || !filePath) return;

    // Never autosave GitHub files
    if (filePath.startsWith("Rotorflight-docs/")) return;

    // Skip autosave once after clone
    if (suppressNextAutosave) {
      setSuppressNextAutosave(false);
      return;
    }

    if (timeout.current) clearTimeout(timeout.current);

    timeout.current = window.setTimeout(async () => {
      setSaving(true);
      try {
        // ⭐ Call your unified save function
        await saveDocument(content);
      } finally {
        setSaving(false);
      }
    }, 3000);

    return () => {
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [
    login,
    workspace,
    filePath,
    content,
    suppressNextAutosave,
    setSuppressNextAutosave,
    saveDocument,
  ]);

  return saving;
}
