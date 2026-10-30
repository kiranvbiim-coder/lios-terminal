import type { z } from "zod";
import { GATEWAY_METHODS } from "@shared/gatewayProtocol";
import { ReadableValue } from "@/components/ui/ReadableValue";

type Proposal = z.output<(typeof GATEWAY_METHODS)["execution.operation.propose"]["result"]>;

export default function SandboxOperationReviewCard({
  proposal,
  busy,
  error,
  onReview,
}: {
  proposal: Proposal;
  busy: boolean;
  error: string | null;
  onReview: (allow: boolean) => void;
}) {
  return (
    <section
      aria-label="Review sandbox terminal operation"
      className="mx-auto mb-3 max-w-4xl space-y-3 rounded-xl border border-amber-300/30 bg-amber-300/[0.035] p-4"
      data-testid="sandbox-operation-review"
    >
      <div>
        <h3 className="font-ui text-sm font-semibold text-foreground">Approve this exact sandbox operation?</h3>
        <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">
          This opens a read-only terminal in an isolated sandbox. Only the listed fixed inputs are accepted; no shell text from Chat is executed.
        </p>
      </div>
      <dl className="grid gap-2 font-terminal text-[11px] text-muted-foreground sm:grid-cols-2">
        <div><dt className="text-foreground/80">Operation</dt><dd>{proposal.label}</dd></div>
        <div><dt className="text-foreground/80">Backend</dt><dd>{proposal.backendId}</dd></div>
        <div><dt className="text-foreground/80">Working directory</dt><dd className="break-all">{proposal.cwd}</dd></div>
        <div><dt className="text-foreground/80">Expires</dt><dd>{new Date(proposal.expiresAtMs).toLocaleTimeString()}</dd></div>
        <div><dt className="text-foreground/80">Isolation</dt><dd>{proposal.isolation.filesystem} filesystem · {proposal.isolation.network} network · {proposal.isolation.processes} processes</dd></div>
        <div><dt className="text-foreground/80">Limits</dt><dd>{proposal.resources.maxWallTimeMs} ms · {proposal.resources.maxCapturedOutputChars} output chars{proposal.resources.maxMemoryBytes ? ` · ${proposal.resources.maxMemoryBytes} bytes memory` : ""}{proposal.resources.maxProcesses ? ` · ${proposal.resources.maxProcesses} processes` : ""}</dd></div>
        {proposal.placement && (
          <>
            <div><dt className="text-foreground/80">Selected node</dt><dd>{proposal.placement.nodeId} · {proposal.placement.kind}</dd></div>
            <div><dt className="text-foreground/80">Trust posture</dt><dd>{proposal.placement.trustPosture}</dd></div>
            <div><dt className="text-foreground/80">Data / secret locality</dt><dd>{proposal.placement.dataLocality} / {proposal.placement.secretLocality}</dd></div>
            <div><dt className="text-foreground/80">Owned endpoint</dt><dd className="break-all">{proposal.placement.endpoint ?? "current Home process"}</dd></div>
          </>
        )}
      </dl>
      <div className="space-y-1">
        <div className="font-ui text-[11px] font-medium text-foreground/80">Exact executable and arguments</div>
        <ReadableValue value={proposal.argv} exact className="max-h-32 overflow-auto rounded border border-border/60 bg-black/30 p-2 font-terminal text-[10px] leading-4 text-foreground/80" />
      </div>
      <div className="space-y-1 font-terminal text-[10px] text-muted-foreground">
        <div>Operation digest: <code className="break-all">{proposal.operationDigest}</code></div>
        <div>Approval digest: <code className="break-all">{proposal.approvalDigest}</code></div>
        <div>Policy revision: <code className="break-all">{proposal.policyRevision}</code></div>
      </div>
      {proposal.interactiveInputPolicy && (
        <div className="font-ui text-xs text-muted-foreground">
          Terminal controls: {proposal.allowedInteractiveInputs.join(" · ")}
        </div>
      )}
      {error && <p role="alert" className="font-ui text-xs text-red-200">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onReview(false)}
          className="rounded-lg border border-border/70 px-3 py-2 font-ui text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Deny
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onReview(true)}
          className="rounded-lg border border-amber-200/40 bg-amber-200/10 px-3 py-2 font-ui text-xs font-semibold text-amber-100 hover:bg-amber-200/15 disabled:opacity-50"
        >
          {busy ? "Reviewing…" : "Approve once and open Terminal"}
        </button>
      </div>
    </section>
  );
}
