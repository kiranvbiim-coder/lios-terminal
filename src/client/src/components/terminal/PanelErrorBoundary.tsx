import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, DownloadCloud } from "lucide-react";

interface Props {
  children: ReactNode;
  paneLabel?: string;
}

interface State {
  error: Error | null;
}

// Every panel is lazy-loaded (see Terminal.tsx's dynamic import()s), so its
// JS chunk is fetched by a content-hashed filename baked into the page the
// browser first loaded. A fresh deploy replaces those files (rsync --delete
// wipes the old ones), so a tab that's been open across a redeploy will 404
// fetching a panel it hasn't visited yet -- this looks like a broken panel
// but is really just a stale page. Recognizable by Vite/React's own error
// text for a failed dynamic import; distinct from an actual code bug.
function isStaleChunkError(error: Error): boolean {
  const msg = error.message || "";
  return /dynamically imported module|Failed to fetch|Importing a module script failed|Loading chunk/i.test(msg);
}

/**
 * Without this, an uncaught error in ANY single panel unmounts the entire
 * React tree — the whole terminal goes blank, not just the broken view. This
 * boundary contains a crash to the one pane that threw, and gives the user a
 * way back out instead of a dead white screen. Wraps the single choke point
 * every panel renders through (Terminal.tsx's renderPaneContent), so it
 * covers all panels, present and future, with one component.
 */
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(`Panel crashed${this.props.paneLabel ? ` (${this.props.paneLabel})` : ""}:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (isStaleChunkError(this.state.error)) {
        return (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <DownloadCloud className="w-5 h-5 text-[hsl(38,95%,55%)]" />
            <div className="font-terminal text-[10px] tracking-widest text-foreground">
              APP WAS UPDATED — RELOAD NEEDED
            </div>
            <div className="font-terminal text-[9px] text-muted-foreground max-w-xs">
              This tab has been open since before the last update, so this panel's files are no longer on the server. Reload to pick up the current version.
            </div>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-1.5 px-2.5 py-1 font-terminal text-[9px] tracking-widest text-black bg-[hsl(38,95%,50%)] hover:bg-[hsl(38,95%,45%)]"
            >
              <RotateCcw className="w-2.5 h-2.5" /> RELOAD APP
            </button>
          </div>
        );
      }
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
          <AlertTriangle className="w-5 h-5 text-[hsl(0,80%,60%)]" />
          <div className="font-terminal text-[10px] tracking-widest text-foreground">
            THIS PANEL CRASHED
          </div>
          <div className="font-terminal text-[9px] text-muted-foreground max-w-xs">
            {this.state.error.message || "Unknown error"}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            className="flex items-center gap-1.5 px-2.5 py-1 font-terminal text-[9px] tracking-widest text-muted-foreground hover:text-foreground border border-border"
          >
            <RotateCcw className="w-2.5 h-2.5" /> RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
