import { createHash } from "node:crypto";
import { runtimeExecutionContextSchema, type RuntimeExecutionContext } from "@shared/runtimeContracts";
import type { ManagedRun } from "../exec/types";
import type { AcpRuntimeHandle, AcpRuntimeStatus } from "./runtime-types";
import type { SessionAcpIdentity } from "./identity-types";
import { createIdentityFromEnsure, createIdentityFromStatus, mergeSessionIdentity } from "./session-identity";
import { toAcpSessionLineageMeta, type AcpSessionLineageMeta } from "./session-lineage-meta";

function ownerKey(context: RuntimeExecutionContext): string {
  let owner: RuntimeExecutionContext;
  try { owner = runtimeExecutionContextSchema.parse(context); } catch {
    throw new Error("ACP metadata requires valid canonical LiOS run context.");
  }
  if (owner.userId === null || owner.projectId === null || owner.conversationId === null) {
    throw new Error("ACP metadata requires an authenticated Project conversation run.");
  }
  // Preserve case and type of opaque LiOS identifiers. External session ids are never consulted.
  return JSON.stringify([owner.organizationId, owner.userId, owner.projectId, owner.conversationId, owner.requestId]);
}

/** Backend resource namespace only; this digest cannot approve, look up or resume a LiOS run. */
export function acpSessionResource(context: RuntimeExecutionContext): string {
  return `lios-acp-v1-${createHash("sha256").update(ownerKey(context)).digest("hex")}`;
}

/**
 * Attributes for an ALREADY admitted GM-11 process. No spawn/approval/store/runtime registry here.
 * The server retains this object with the canonical run; external locators cannot reconstruct it.
 * Explicit resume must re-enter GM-12/GM-11, not deserialize an ACP handle into process custody.
 */
export class BoundAcpSession {
  private readonly owner: string;
  private readonly requestId: string;
  private readonly processRunId: string;
  private readonly handle: Readonly<AcpRuntimeHandle>;
  private identity: SessionAcpIdentity | undefined;
  private cancellation?: Promise<void>;
  private revoked = false;

  constructor(context: RuntimeExecutionContext, handle: AcpRuntimeHandle, private readonly run: ManagedRun) {
    this.owner = ownerKey(context);
    this.requestId = context.requestId;
    this.processRunId = run.runId;
    if (!run.waitForExtinction || handle.sessionKey !== acpSessionResource(context) ||
        handle.agentId !== String(context.userId) || !handle.backend.trim() || !handle.runtimeSessionName.trim()) {
      throw new Error("ACP handle does not bind to the admitted LiOS run.");
    }
    this.handle = Object.freeze({ ...handle });
    this.identity = createIdentityFromEnsure({ handle: this.handle, now: Date.now() });
  }

  private assertOwner(context: RuntimeExecutionContext): void {
    if (ownerKey(context) !== this.owner || this.run.runId !== this.processRunId) {
      throw new Error("ACP metadata belongs to another LiOS run.");
    }
  }

  observeStatus(context: RuntimeExecutionContext, status: AcpRuntimeStatus): void {
    this.assertOwner(context);
    if (this.revoked) throw new Error("ACP run admission is closed.");
    const incoming = createIdentityFromStatus({ status, now: Date.now() });
    for (const field of ["acpxRecordId", "acpxSessionId", "agentSessionId"] as const) {
      const existing = this.identity?.[field];
      if (existing && incoming?.[field] && existing !== incoming[field]) {
        throw new Error("ACP runtime locator drift requires explicit governed recovery.");
      }
    }
    this.identity = mergeSessionIdentity({ current: this.identity, incoming, now: Date.now() });
  }

  metadata(context: RuntimeExecutionContext): {
    requestId: string;
    processRunId: string;
    backend: string;
    identity?: SessionAcpIdentity;
    lineage: AcpSessionLineageMeta;
    admissionClosed: boolean;
  } {
    this.assertOwner(context);
    return {
      requestId: this.requestId,
      processRunId: this.processRunId,
      backend: this.handle.backend,
      ...(this.identity ? { identity: { ...this.identity } } : {}),
      lineage: toAcpSessionLineageMeta({ key: this.requestId, kind: "coding", channel: "project_chat" }),
      admissionClosed: this.revoked,
    };
  }

  /** Cancel exact process custody, not a PID/backend session id; join extinction before settling. */
  cancel(context: RuntimeExecutionContext): Promise<void> {
    this.assertOwner(context);
    if (this.cancellation) return this.cancellation;
    this.revoked = true;
    this.cancellation = (async () => {
      // Output and admission close before cancellation; caller/backend error text is never retained.
      let failed = false;
      try { this.run.detachOutput?.(); } catch { failed = true; }
      try { this.run.cancel("manual-cancel"); } catch { failed = true; }
      const results = await Promise.allSettled([
        Promise.resolve().then(() => this.run.wait()),
        Promise.resolve().then(() => this.run.waitForExtinction!()),
      ]);
      if (failed || results.some((result) => result.status === "rejected")) {
        throw new Error("ACP cancellation cleanup could not be confirmed by the execution authority.");
      }
    })();
    return this.cancellation;
  }
}
