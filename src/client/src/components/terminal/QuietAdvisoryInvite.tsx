import { ArrowUpRight, BriefcaseBusiness } from "lucide-react";
import { ADVISORY_SERVICE_STEPS } from "@/lib/advisoryDiscoveryPolicy";

/**
 * Optional, non-modal commercial disclosure. Lives below actual Project work,
 * never overlays Chat, performs no navigation until click and sends no Project
 * name, content, conversation, finance data or telemetry to advisory.
 */
export function QuietAdvisoryInvite({
  onExplore, onDismiss,
}: { onExplore: () => void; onDismiss: () => void }) {
  return (
    <aside data-testid="quiet-advisory-invite" aria-label="Optional professional advisory services"
      className="mt-8 rounded-2xl border border-border/65 bg-card/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/70 text-muted-foreground"
          aria-hidden="true"><BriefcaseBusiness className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1 space-y-1">
          <span className="font-ui text-xs text-muted-foreground">Also available · Optional professional service</span>
          <h2 className="font-ui text-base font-semibold tracking-[-0.01em] text-foreground">Expert support for complex decisions</h2>
          <p className="max-w-2xl font-ui text-[13px] leading-5 text-muted-foreground">
            Limuria consulting is separate from self-service LiOS tools. If you want specialist input,
            you can explore a scoped engagement on your terms.
          </p>
        </div>
        <button type="button" onClick={onDismiss} className="min-h-10 rounded-lg px-3 font-ui text-[13px] text-muted-foreground hover:bg-white/[.04] hover:text-foreground"
          aria-label="Hide optional advisory invitation for this session">Not now</button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onExplore}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background/50 px-4 font-ui text-sm font-semibold text-foreground hover:border-foreground/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">
          Explore advisory services <ArrowUpRight className="h-4 w-4" aria-hidden="true"/>
        </button>
        <details className="group min-w-0 flex-1">
          <summary className="min-h-10 cursor-pointer rounded-lg px-2 py-2 font-ui text-[13px] text-muted-foreground hover:text-foreground">
            How engagements work
          </summary>
          <ol className="mt-2 list-inside list-decimal space-y-1 rounded-lg border border-border/60 p-3 font-ui text-xs leading-5 text-muted-foreground">
            {ADVISORY_SERVICE_STEPS.map(step => <li key={step}>{step}</li>)}
          </ol>
        </details>
      </div>
      <p className="mt-3 font-ui text-xs text-muted-foreground">Nothing in this Project is shared with consultants by viewing this invitation. You decide what to include in any request.</p>
    </aside>
  );
}
