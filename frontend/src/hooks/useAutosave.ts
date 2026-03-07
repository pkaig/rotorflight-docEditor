import { useEffect, useRef, useState } from "react";

export function useAutosave(
  login: string | null,
  filePath: string,
  content: string,
  saveFn: (cleanPath: string, content: string) => Promise<void> | void,
) {
  const [saving, setSaving] = useState(false);
  const timeout = useRef<number | null>(null);

  useEffect(() => {
    if (!login || !filePath) return;

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
  }, [content, login, filePath]);

  return saving;
}
