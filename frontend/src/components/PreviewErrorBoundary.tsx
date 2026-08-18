/* frontend/src/components/PreviewErrorBoundary.tsx
 *
 * Description of responsibility:
 *   Class-based error boundary scoped to the Preview panel only —
 *   catches MDX render errors and reports the offending line number up
 *   to App.tsx (via onError) so EditorPanel can highlight it, instead
 *   of letting a preview crash take down the whole app.
 *
 * Info:
 *   Kept separate from AppErrorBoundary specifically so a broken
 *   preview never takes the editor down with it — the user can keep
 *   editing and fix the doc while only the preview pane shows an
 *   error.
 *
 *   Once state.error is set, this stays latched forever — render()
 *   below returns the error box unconditionally whenever it's set,
 *   with nothing in this file that ever clears it back to null. React
 *   only resets a class component's state by unmounting and remounting
 *   it, so the caller MUST render this with a `key` that changes
 *   whenever the thing being previewed changes (App.tsx keys it by
 *   currentDocPath) — without that, one broken doc permanently blanks
 *   the preview for every doc opened afterward, since it's still the
 *   same latched instance.
 */
import React from "react";

export default class PreviewErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: (line: number | null) => void },
  { error: any }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { error };
  }

  componentDidCatch(error: any) {
    const msg = error.message || String(error);
    const match = msg.match(/line (\d+)/i);
    const line = match ? parseInt(match[1], 10) : null;
    this.props.onError(line);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            borderLeft: "6px solid #e53935",
            background: "#ffebee",
            padding: "1rem",
            borderRadius: 6,
            margin: "1rem 0",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
            Preview Error
          </div>
          <div style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
            {String(this.state.error.message || this.state.error)}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
