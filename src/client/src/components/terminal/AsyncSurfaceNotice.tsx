import type { AsyncSurfaceState } from "@/lib/asyncSurfaceState";

type AsyncSurfaceNoticeProps = {
  surface: "artifact" | "connections";
  state: Exclude<AsyncSurfaceState, "ready">;
  onRetry?: () => void;
  retrying?: boolean;
  onLeave?: () => void;
  leaveLabel?: string;
};

const MESSAGES: Record<AsyncSurfaceNoticeProps["surface"], Record<Exclude<AsyncSurfaceState, "ready">, { title: string; detail: string }>> = {
  artifact: {
    loading: { title: "Loading saved Artifact", detail: "Retrieving the recorded revision. Your existing work is not being changed." },
    signed_out: { title: "Sign in required", detail: "Your session cannot read this Artifact. Sign in again before retrying; no revision was changed." },
    denied: { title: "Artifact access restricted", detail: "You do not have permission to view this saved Artifact in the current session. Ask its owner for access." },
    missing: { title: "Artifact not available", detail: "The saved Artifact or requested revision cannot be found here. It may have moved, been removed, or be unavailable to this account." },
    failed: { title: "Artifact could not load", detail: "The saved revision could not be retrieved. Retry the read; no local draft or saved revision was overwritten." },
  },
  connections: {
    loading: { title: "Loading connection setup", detail: "Checking your locally configured providers and setup status. No provider test or connection is started by loading this page." },
    signed_out: { title: "Sign in required", detail: "Your session cannot read the connection setup. Sign in again before reviewing provider settings." },
    denied: { title: "Connection setup restricted", detail: "Your current account does not have access to connection setup. Existing provider credentials have not been changed." },
    missing: { title: "Connection setup unavailable", detail: "The setup service is not available here. Check the app runtime and retry; saved connection settings have not been reset." },
    failed: { title: "Could not load connection setup", detail: "The setup service did not respond successfully. Retry the read; no provider was connected, tested, or authorized." },
  },
};

/** A visible recovery boundary, not an alternative auth, provider, or state machine. */
export default function AsyncSurfaceNotice({ surface, state, onRetry, retrying = false, onLeave, leaveLabel = "Close" }: AsyncSurfaceNoticeProps) {
  const message = MESSAGES[surface][state];
  const loading = state === "loading";
  return (
    <section
      className="mx-auto flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border/70 bg-background p-5 font-ui text-foreground"
      role={loading ? "status" : "alert"}
      aria-live={loading ? "polite" : "assertive"}
      aria-busy={loading || retrying}
      data-testid={`async-${surface}-state`}
      data-read-state={state}
    >
      <h2 className="text-base font-semibold">{message.title}</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">{message.detail}</p>
      {!loading && (
        <div className="flex flex-wrap gap-2">
          {onRetry && state !== "denied" && (
            <button
              type="button"
              disabled={retrying}
              className="min-h-10 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
              onClick={onRetry}
            >{retrying ? "Retrying…" : state === "signed_out" ? "Retry after sign-in" : "Retry loading"}</button>
          )}
          {onLeave && (
            <button
              type="button"
              className="min-h-10 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              onClick={onLeave}
            >{leaveLabel}</button>
          )}
        </div>
      )}
    </section>
  );
}
