/* frontend/src/hooks/useVersionGate.ts
 *
 * Description of responsibility:
 *   Fetches the remote version-gate config directly from
 *   raw.githubusercontent.com and derives whether the app should show
 *   a maintenance/forced-update/update-available state.
 *
 * Info:
 *   Not currently imported anywhere — App.tsx has its own inline copy
 *   of this same check (evaluateStatus/checkStatus in App.tsx, fetching
 *   via the backend's /api/version proxy instead of hitting
 *   raw.githubusercontent.com directly). Left in place since removing
 *   unused code wasn't in scope of this pass, but a future cleanup
 *   should pick one implementation and delete the other.
 */
import { useEffect, useState } from "react";

const APP_VERSION = "1.4.2";

type EditorStatus = null | {
  type: "blocked" | "forceUpdate" | "updateAvailable" | "ok";
  message?: string;
  current?: string;
  latest?: string;
  downloadUrl?: string;
};

export function useVersionGate() {
  const [editorStatus, setEditorStatus] = useState<EditorStatus>(null);

  useEffect(() => {
    async function checkStatus() {
      const url =
        "https://raw.githubusercontent.com/rotorflight/rotorflight-docs/main/config/docEditorStatus.json";

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        setEditorStatus({ type: "ok" });
        return;
      }

      const cfg = await res.json();
      const dismissedUntil = localStorage.getItem("rf_dismissed_until");

      if (dismissedUntil && Date.now() < Number(dismissedUntil)) {
        setEditorStatus({ type: "ok" });
        return;
      }

      function compare(a: string, b: string) {
        const pa = a.split(".").map(Number);
        const pb = b.split(".").map(Number);
        for (let i = 0; i < 3; i++) {
          if (pa[i] > pb[i]) return 1;
          if (pa[i] < pb[i]) return -1;
        }
        return 0;
      }

      if (cfg.blocked) {
        setEditorStatus({ type: "blocked", message: cfg.blockMessage });
        return;
      }

      if (compare(APP_VERSION, cfg.minSupportedVersion) < 0) {
        setEditorStatus({
          type: "forceUpdate",
          current: APP_VERSION,
          latest: cfg.latestVersion,
          message: cfg.updateMessage,
          downloadUrl: cfg.downloadUrl,
        });
        return;
      }

      if (compare(APP_VERSION, cfg.latestVersion) < 0) {
        setEditorStatus({
          type: "updateAvailable",
          current: APP_VERSION,
          latest: cfg.latestVersion,
          message: cfg.updateMessage,
          downloadUrl: cfg.downloadUrl,
        });
        return;
      }

      setEditorStatus({ type: "ok" });
    }

    checkStatus();
  }, []);

  return { editorStatus, setEditorStatus };
}
