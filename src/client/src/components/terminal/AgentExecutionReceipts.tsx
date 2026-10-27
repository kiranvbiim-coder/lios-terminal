/**
 * Premium, read-only execution receipt presentation inspired by beUI's
 * AgentActivity and ToolApproval status families.
 *
 * Upstream: starc007/ui-components, MIT, pinned source reviewed in
 * docs/ux/LIOS_PREMIUM_UI_FINAL_FOUR_PHASE_EXECUTION_2026-10-27.md
 *
 * IMPORTANT: P2 / GM emit and validate execution receipts. This component
 * cannot grant approvals, infer success, re-run actions or expose raw evidence.
 */
import * as React from "react";
import { AlertCircle, Ban, CheckCircle2, FileCheck2, ShieldCheck } from "lucide-react";
import { type AgentReceiptActivity, receiptPresentation } from "@/lib/agentReceiptActivity";

interface Props {
  activity: AgentReceiptActivity;
}

const receiptAppearance = {
  completed: { icon: CheckCircle2, label: "Completed", className: "border-emerald-300/25 bg-emerald-300/[0.065] text-emerald-200" },
  failed: { icon: AlertCircle, label: "Failed", className: "border-rose-300/25 bg-rose-300/[0.065] text-rose-200" },
  cancelled: { icon: Ban, label: "Cancelled", className: "border-amber-300/25 bg-amber-300/[0.065] text-amber-200" },
} as const;

export default function AgentExecutionReceipts({ activity }: Props) {
  if (!activity.receipts.length) return null;

  return (
    <section
      aria-label="Observed execution receipts"
      data-testid="trace-agent-receipts"
      className="space-y-3 rounded-xl border border-border/55 bg-white/[0.016] p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-white/[0.035] text-foreground/70">
          <FileCheck2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-ui text-sm font-semibold text-foreground">Recorded execution receipts · {activity.receipts.length}</h3>
          <p className="mt-0.5 font-ui text-xs text-muted-foreground">Evidence for this exact run, not permission to act</p>
        </div>
        <span className="rounded-full border border-border/65 px-2.5 py-1 font-ui text-xs tabular-nums text-muted-foreground">
          {activity.completed} completed · {activity.failed} failed · {activity.cancelled} cancelled
        </span>
      </div>
      <p className="font-ui text-xs leading-5 text-muted-foreground">
        Step reports, model plans and text are not execution receipts. Receipts do not grant approval or prove an external action occurred; check the original governed review and external system before relying on side effects.
      </p>
      <ol className="grid gap-2" aria-label="Execution receipts for this run">
        {activity.receipts.map((receipt) => {
          const info = receiptPresentation(receipt);
          const appearance = receiptAppearance[receipt.status];
          const Icon = appearance.icon;
          return (
            <li
              key={receipt.id}
              data-receipt-status={receipt.status}
              className="min-w-0 space-y-2 rounded-lg border border-border/60 bg-background/40 p-3"
            >
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="break-words font-ui text-sm font-semibold leading-5 text-foreground">
                    {receipt.componentId} · {info.operation}
                  </div>
                  <div className="mt-1 font-ui text-xs text-muted-foreground">{info.kind} · {info.sourceCount} recorded source ref{info.sourceCount === 1 ? "" : "s"}</div>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-ui text-xs font-semibold ${appearance.className}`}>
                  <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> {appearance.label}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 font-ui text-xs text-muted-foreground">
                <span className="rounded-md border border-border/55 px-2 py-1">Input hash {info.hasInputHash ? "recorded" : "absent"}</span>
                <span className="rounded-md border border-border/55 px-2 py-1">Output hash {info.hasOutputHash ? "recorded" : "absent"}</span>
                {info.warnings > 0 && <span className="rounded-md border border-amber-300/30 px-2 py-1 text-amber-200">{info.warnings} warning{info.warnings === 1 ? "" : "s"}</span>}
              </div>
              <details className="font-ui text-xs text-muted-foreground">
                <summary className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1 font-medium text-foreground outline-none hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-amber-300/70">
                  <ShieldCheck aria-hidden="true" className="h-4 w-4 text-foreground/70" />
                  Exact receipt identity and hashes
                </summary>
                <dl className="mt-2 grid gap-1.5 overflow-wrap-anywhere rounded-md border border-border/50 bg-black/10 p-3 font-mono text-xs">
                  <div className="min-w-0 break-all"><dt className="inline font-semibold">Receipt</dt><dd className="ml-2 inline">{receipt.id}</dd></div>
                  <div className="min-w-0 break-all"><dt className="inline font-semibold">Run</dt><dd className="ml-2 inline">{receipt.requestId}</dd></div>
                  <div className="min-w-0 break-all"><dt className="inline font-semibold">Started</dt><dd className="ml-2 inline">{receipt.startedAt}</dd></div>
                  <div className="min-w-0 break-all"><dt className="inline font-semibold">Finished</dt><dd className="ml-2 inline">{receipt.completedAt}</dd></div>
                  <div className="min-w-0 break-all"><dt className="inline font-semibold">Input SHA-256</dt><dd className="ml-2 inline">{receipt.inputHash ?? "not recorded"}</dd></div>
                  <div className="min-w-0 break-all"><dt className="inline font-semibold">Output SHA-256</dt><dd className="ml-2 inline">{receipt.outputHash ?? "not recorded"}</dd></div>
                </dl>
                <p className="mt-2 leading-5">Raw request/response evidence, provider credentials, and source URI values are not exposed by this summary.</p>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
