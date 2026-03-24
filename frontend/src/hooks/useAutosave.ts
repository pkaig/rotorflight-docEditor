import { useEffect, useRef, useState } from "react";

export function useAutosave(
  login: string | null,
  workspace: string | null,
  filePath: string,
  content: string,
  suppressNextAutosave: boolean,
  setSuppressNextAutosave: (v: boolean) => void,
  saveFn: (cleanPath: string, content: string) => Promise<void> | void,
) {
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
        await saveFn(filePath, content);
      } finally {
        setSaving(false);
      }
    }, 400);

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
    saveFn,
  ]);

  return saving;
}
