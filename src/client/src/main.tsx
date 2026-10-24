import { createRoot } from "react-dom/client";
import { Component, type ErrorInfo, type ReactNode } from "react";
import App from "./App";
import SignatureCursor from "./components/terminal/SignatureCursor";
import { getAudience } from "./lib/audience";
import { reportTerminalCrash } from "./lib/terminalTelemetry";
import "./terminalStyles";

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Terminal startup failed", error, info.componentStack);
    if (getAudience() === "client") void reportTerminalCrash(error, "react_root_error_boundary");
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="dark min-h-screen text-foreground flex items-center justify-center p-6 font-terminal"
        style={{ backgroundColor: "var(--lios-bg-app)" }}>
        <section className="w-full max-w-xl border border-red-900/70 p-5 shadow-2xl"
          style={{ backgroundColor: "var(--lios-bg-panel)" }}>
          <div className="mb-4 font-terminal text-sm font-bold tracking-[0.16em]"
            style={{ color: "var(--lios-brand)" }}>LiOS Terminal</div>
          <h1 className="text-sm font-bold uppercase text-red-500">INTELLIGENCE ENVIRONMENT INTERRUPTED</h1>
          <p className="mt-3 break-words text-xs leading-relaxed text-muted-foreground">
            {this.state.error.message || "The terminal could not initialize this analytical environment."}
          </p>
          <button
            type="button"
            className="lios-root-recovery-action mt-5 min-h-11 border px-4 text-sm font-bold"
            onClick={() => window.location.reload()}
          >
            Reinitialize LiOS
          </button>
        </section>
      </main>
    );
  }
}

if (!window.location.hash) {
  window.location.hash = "#/";
}

// V5 is dark-only by product contract. Accessibility variants may change
// semantic up/down colors, but never switch the surface theme.
document.documentElement.classList.add("dark");
document.documentElement.setAttribute("data-theme", "dark");

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <App />
    <SignatureCursor />
  </RootErrorBoundary>,
);

// The Terminal is versioned and redeployed frequently. A previously shipped
// service worker cached the app shell and could keep an old index.html alive
// after its hashed JS files had disappeared, leaving browsers on a permanent
// blank screen. The production /sw.js is a one-shot retirement worker: existing
// registrations update it automatically, then it clears old caches, unregisters
// itself, and reloads controlled pages. Never register that worker from the
// current app or each visit would restart its retirement/reload cycle.
// Development still removes any old registration.
if ("serviceWorker" in navigator && !import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch(() => {});

    if ("caches" in window) {
      caches.keys()
        .then((keys) => Promise.all(keys.filter((key) => key.startsWith("limuria-")).map((key) => caches.delete(key))))
        .catch(() => {});
    }
  });
}
