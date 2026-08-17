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
  if (!AUTOSAVE_ENABLED) return;

  // Ignore invalid content
  if (content === undefined || content === null) return;
  if (typeof content !== "string") return;

  const [saving, setSaving] = useState(false);
  const timeout = useRef<number | null>(null);

  useEffect(() => {
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
