/* frontend/src/hooks/useDiffPreviewScrollSync.ts
 *
 * Description of responsibility:
 *   Keeps the Diff view and the preview panel scrolling together while
 *   "Show Diff" is active — each keeps its own native scrollbar (unlike
 *   the editor/preview pair, which shares one custom scrollbar; see
 *   SplitScrollbar.tsx), this just mirrors scroll *position* between
 *   them proportionally.
 *
 * Info:
 *   Deliberately plain percentage sync, not the editor/preview pair's
 *   image-anchored one (see useEditorPreviewScrollSync) — that anchoring
 *   depends on matching the Nth image-referencing *source line* to the
 *   Nth rendered <img>, which assumes the left side's line numbers are
 *   the live doc's own. A diff interleaves +/- and context lines against
 *   a *different* revision, so there's no line-for-line correspondence
 *   to anchor against; a straight scrollTop-fraction match is the
 *   honest amount of sync actually possible here.
 */
import { useEffect } from "react";

export function useDiffPreviewScrollSync(
  diffScrollRef: React.RefObject<HTMLDivElement | null>,
  previewPanelRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  // UnifiedDiffViewer remounts (key={currentFile} in App.tsx) with a
  // fresh .diff-scroll element whenever the file changes — switching
  // between two changed files never toggles `enabled` off and back on,
  // so without this in the dependency list the effect would keep its
  // listeners on the old, now-unmounted element instead of reattaching.
  resetKey: string,
) {
  useEffect(() => {
    if (!enabled) return;

    const panel = previewPanelRef.current;
    if (!panel) return;

    let syncing = false;
    let attachedTo: HTMLDivElement | null = null;

    function fractionOf(el: HTMLElement): number {
      const max = el.scrollHeight - el.clientHeight;
      return max > 0 ? el.scrollTop / max : 0;
    }

    function onDiffScroll() {
      const diffEl = attachedTo;
      if (syncing || !diffEl) return;
      syncing = true;
      const max = panel!.scrollHeight - panel!.clientHeight;
      panel!.scrollTop = fractionOf(diffEl) * Math.max(0, max);
      syncing = false;
    }

    function onPreviewScroll() {
      const diffEl = attachedTo;
      if (syncing || !diffEl) return;
      syncing = true;
      const max = diffEl.scrollHeight - diffEl.clientHeight;
      diffEl.scrollTop = fractionOf(panel!) * Math.max(0, max);
      syncing = false;
    }

    panel.addEventListener("scroll", onPreviewScroll);

    // UnifiedDiffViewer's .diff-scroll doesn't exist yet on the very
    // first run of this effect — it only renders once the diff itself
    // has finished its own async fetch (see its `loading` state), by
    // which point this effect has already run and found a null ref.
    // Poll briefly rather than requiring a load-complete callback wired
    // all the way through App.tsx just for this.
    let pollCount = 0;
    const pollId = window.setInterval(() => {
      const diffEl = diffScrollRef.current;
      pollCount++;
      if (diffEl && diffEl !== attachedTo) {
        attachedTo = diffEl;
        diffEl.addEventListener("scroll", onDiffScroll);
        window.clearInterval(pollId);
      } else if (pollCount > 40) {
        window.clearInterval(pollId); // ~6s — diff genuinely failed to load
      }
    }, 150);

    return () => {
      window.clearInterval(pollId);
      panel.removeEventListener("scroll", onPreviewScroll);
      attachedTo?.removeEventListener("scroll", onDiffScroll);
    };
  }, [enabled, diffScrollRef, previewPanelRef, resetKey]);
}
