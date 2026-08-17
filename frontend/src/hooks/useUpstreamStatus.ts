/* frontend/src/hooks/useUpstreamStatus.ts
 *
 * Description of responsibility:
 *   Checks whether the shared global mirror of upstream
 *   rotorflight-docs is stale on login, and triggers (and reports
 *   progress on) a mirror refresh if so, for the "Checking
 *   upstream…"/"Updating Rotorflight-docs…" sidebar banner.
 *
 * Info:
 *   Distinct from PRDescriptionModal's own upstream check — that one
 *   rebases a single workspace's local edits against a fresh mirror
 *   right before a PR submission; this one just keeps the shared
 *   global mirror itself current in the background.
 */
// useUpstreamStatus.ts
import { useEffect, useState } from "react";

export function useUpstreamStatus(login: string) {
  const [checking, setChecking] = useState(true);
  const [stale, setStale] = useState(false);
  const [updating, setUpdating] = useState(false);

  async function check() {
    if (!login) return;
    setChecking(true);
    setStale(false);

    const res = await fetch(
      `/api/reset-mirror/upstream-status?login=${encodeURIComponent(login)}`,
    );
    const data = await res.json();

    if (data.stale) {
      setStale(true);
      setUpdating(true);

      // Trigger mirror refresh
      await fetch(`/api/reset-mirror?login=${encodeURIComponent(login)}`, {
        method: "POST",
      });

      setUpdating(false);
      setStale(false);
    }

    setChecking(false);
  }

  useEffect(() => {
    if (!login) return;
    check();
  }, [login]);

  return { checking, stale, updating, refresh: check };
}
