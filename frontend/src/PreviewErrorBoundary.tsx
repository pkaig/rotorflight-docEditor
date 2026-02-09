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
