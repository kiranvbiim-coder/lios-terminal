import * as React from "react";

/**
 * Only guards an opt-in, lazy-loaded visual timeline. The canonical News
 * publisher links and P9 workflow source/history records live OUTSIDE this
 * boundary and must remain usable if a vendor animation chunk cannot load.
 * No source text, stack trace, network address or exception is rendered.
 */
export class OptionalTimelineBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <p role="alert" className="mt-3 font-ui text-xs leading-5 text-muted-foreground">
        Interactive timeline unavailable. Original recorded items and source history remain available.
      </p>;
    }
    return this.props.children;
  }
}
