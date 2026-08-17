/* frontend/src/components/AppErrorBoundary.tsx
 *
 * Description of responsibility:
 *   Class-based React error boundary wrapping the whole app — catches
 *   otherwise-fatal render errors and shows a plain fallback message
 *   instead of a blank white screen.
 *
 * Info:
 *   Must be a class component; React error boundaries have no hook
 *   equivalent.
 */
import React from "react";

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, info: any) {
    console.log("ERROR BOUNDARY CAUGHT:", error);
    console.log("ERROR INFO:", info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20 }}>
          <h2>Something went wrong in the app.</h2>
          <p>Check the console for details.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
