import {
  reproducibilityReceiptSchema,
  type FormulaReference,
  type LedgerLineageGraph,
  type ProviderObservation,
  type ReproducibilityReceipt,
} from "@shared/ledgerContracts";
import type {
  ConversationRequest,
  ConversationRuntimeEvent,
  WorkflowPlan,
} from "@shared/conversationRuntime";
import type { RuntimeExecutionReceipt } from "@shared/runtimeContracts";
import type { TenantContext } from "./tenantContext";
import {
  appendLedgerEvent,
  hashLedgerValue,
  sanitizeLedgerPayload,
} from "./ledgerStore";

function formulaRefs(operation: string): FormulaReference[] {
  if (operation !== "technical-snapshot") return [];
  return [
    { name: "RSI", expression: "Wilder RSI(close, 14)", version: "14-wilder" },
    { name: "MACD", expression: "EMA(close,12) - EMA(close,26); signal EMA(9)", version: "12-26-9" },
    { name: "Support/Resistance", expression: "min/max close over trailing 20 sessions", version: "20-session" },
  ];
}

function engineRefs(receipt: RuntimeExecutionReceipt) {
  const ids = receipt.operation === "technical-snapshot"
    ? ["lios.finance.technical", receipt.componentId]
    : [receipt.componentId];
  return [...new Set(ids)].map((id) => ({
    id,
    version: "runtime-contract-v1",
    componentId: id,
  }));
}

function providerObservations(receipt: RuntimeExecutionReceipt): ProviderObservation[] {
  return receipt.sourceRefs.flatMap((sourceRef) => {
    const match = /^(?:provider|ai-provider):(.+)$/i.exec(sourceRef);
    if (!match) return [];
    return [{
      provider: match[1],
      sourceRef,
      observedAt: receipt.completedAt,
      asOf: null,
      hash: null,
    }];
  });
}

function isoAsOf(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function executionLineage(input: {
  requestId: string;
  sessionId: string | null;
  receipt: RuntimeExecutionReceipt;
  artifactIds: string[];
}): LedgerLineageGraph {
  const executionRef = `execution:${input.requestId}`;
  const nodes: LedgerLineageGraph["nodes"] = [
    { kind: "execution", ref: executionRef, version: "1", hash: input.receipt.outputHash, asOf: input.receipt.completedAt, metadata: { operation: input.receipt.operation } },
    ...input.receipt.sourceRefs.map((ref) => ({ kind: ref.startsWith("provider:") || ref.startsWith("ai-provider:") ? "provider" as const : "source" as const, ref, version: null, hash: null, asOf: null, metadata: {} })),
    ...engineRefs(input.receipt).map((engine) => ({ kind: "engine" as const, ref: engine.id, version: engine.version, hash: null, asOf: null, metadata: {} })),
    ...(input.sessionId ? [{ kind: "session" as const, ref: input.sessionId, version: null, hash: null, asOf: null, metadata: {} }] : []),
    ...input.artifactIds.map((ref) => ({ kind: "artifact" as const, ref, version: "draft", hash: null, asOf: null, metadata: {} })),
  ];
  const edges: LedgerLineageGraph["edges"] = [
    ...input.receipt.sourceRefs.map((ref) => ({ from: ref, to: executionRef, relation: "used" as const })),
    ...engineRefs(input.receipt).map((engine) => ({ from: engine.id, to: executionRef, relation: "used" as const })),
    ...(input.sessionId ? [{ from: input.sessionId, to: executionRef, relation: "configured_by" as const }] : []),
    ...input.artifactIds.map((ref) => ({ from: executionRef, to: ref, relation: "produced" as const })),
  ];
  return { nodes, edges };
}

export interface ConversationLedgerRecorderInput {
  tenant: TenantContext;
  projectId: number | null;
  chatId: number;
  sessionId: string | null;
  request: ConversationRequest;
  plan: WorkflowPlan;
}

export function createConversationLedgerRecorder(input: ConversationLedgerRecorderInput) {
  const artifactIdsByReceipt = new Map<string, string[]>();
  const asOfByReceipt = new Map<string, string>();
  let failedRecorded = false;

  async function recordRequest(): Promise<void> {
    await appendLedgerEvent(input.tenant, {
      projectId: input.projectId,
      chatId: input.chatId,
      sessionId: input.sessionId,
      eventType: "conversation.requested",
      actorType: "user",
      requestId: input.request.requestId,
      correlationId: input.request.continuationOf ?? input.request.requestId,
      payload: {
        messageHash: hashLedgerValue(input.request.message),
        executionMode: input.request.executionMode,
        sourceScope: input.request.sourceScope,
        capabilityIds: input.plan.capabilities.map((capability) => capability.id),
        continuationOf: input.request.continuationOf,
        approvals: input.request.approvals,
        context: sanitizeLedgerPayload(input.request.context ?? {}),
        transmissionPolicyHash: hashLedgerValue(input.request.transmissionPolicy),
      },
      lineage: {
        nodes: [
          { kind: "conversation", ref: `chat:${input.chatId}`, version: "1", hash: null, asOf: null, metadata: {} },
          { kind: "execution", ref: `execution:${input.request.requestId}`, version: "1", hash: null, asOf: null, metadata: { action: input.plan.intent.action } },
          ...(input.sessionId ? [{ kind: "session" as const, ref: input.sessionId, version: null, hash: null, asOf: null, metadata: {} }] : []),
        ],
        edges: [
          { from: `chat:${input.chatId}`, to: `execution:${input.request.requestId}`, relation: "used" },
          ...(input.sessionId ? [{ from: input.sessionId, to: `execution:${input.request.requestId}`, relation: "configured_by" as const }] : []),
        ],
      },
    });
  }

  function buildReceipt(runtime: RuntimeExecutionReceipt): ReproducibilityReceipt {
    const artifactIds = artifactIdsByReceipt.get(runtime.id) ?? [];
    const asOf = asOfByReceipt.get(runtime.id) ?? null;
    const aiInvolvement = runtime.aiDerived
      ? (input.request.executionMode === "ai_direct" ? "direct" : "assisted")
      : "none";
    const withoutIntegrity = {
      schemaVersion: "1" as const,
      receiptId: runtime.id,
      requestId: runtime.requestId,
      projectId: input.projectId,
      chatId: input.chatId,
      sessionId: input.sessionId,
      operation: runtime.operation,
      status: runtime.status,
      deterministic: runtime.deterministic,
      aiInvolvement,
      startedAt: runtime.startedAt,
      completedAt: runtime.completedAt,
      asOf,
      inputHash: runtime.inputHash,
      outputHash: runtime.outputHash,
      inputSnapshot: {
        messageHash: hashLedgerValue(input.request.message),
        executionMode: input.request.executionMode,
        sourceScope: input.request.sourceScope,
        intent: sanitizeLedgerPayload(input.plan.intent),
        capabilities: sanitizeLedgerPayload(input.plan.capabilities.map((capability) => ({
          id: capability.id,
          availability: capability.availability,
          permissionClass: capability.permissionClass,
          sourceScopeCompatible: capability.sourceScopeCompatible,
        }))),
        context: sanitizeLedgerPayload(input.request.context ?? {}),
        executionEvidence: sanitizeLedgerPayload(runtime.inputEvidence ?? {}),
      },
      outputSnapshot: {
        runtimeOutputHash: runtime.outputHash,
        artifactDraftIds: artifactIds,
        executionEvidence: sanitizeLedgerPayload(runtime.outputEvidence ?? {}),
      },
      sourceRefs: runtime.sourceRefs,
      providerObservations: providerObservations(runtime),
      formulas: formulaRefs(runtime.operation),
      engines: engineRefs(runtime),
      assumptions: [],
      warnings: runtime.warnings,
      lineage: executionLineage({
        requestId: input.request.requestId,
        sessionId: input.sessionId,
        receipt: runtime,
        artifactIds,
      }),
    };
    return reproducibilityReceiptSchema.parse({
      ...withoutIntegrity,
      integrityHash: hashLedgerValue(withoutIntegrity),
    });
  }

  async function recordRuntimeEvent(event: ConversationRuntimeEvent): Promise<void> {
    if (event.type === "artifact") {
      const asOf = isoAsOf(event.artifact.data.asOf);
      for (const receiptId of event.artifact.executionReceiptIds) {
        const ids = artifactIdsByReceipt.get(receiptId) ?? [];
        ids.push(event.artifact.artifactId);
        artifactIdsByReceipt.set(receiptId, ids);
        if (asOf) asOfByReceipt.set(receiptId, asOf);
      }
      await appendLedgerEvent(input.tenant, {
        projectId: input.projectId,
        chatId: input.chatId,
        sessionId: input.sessionId,
        eventType: "artifact.draft.emitted",
        actorType: input.request.executionMode === "ai_direct" ? "ai" : "engine",
        requestId: input.request.requestId,
        payload: { artifact: sanitizeLedgerPayload(event.artifact) as Record<string, unknown> },
        lineage: {
          nodes: [
            { kind: "artifact", ref: event.artifact.artifactId, version: "draft", hash: hashLedgerValue(event.artifact.data), asOf, metadata: { artifactType: event.artifact.artifactType } },
            ...event.artifact.executionReceiptIds.map((id) => ({ kind: "execution" as const, ref: `receipt:${id}`, version: "1", hash: null, asOf: null, metadata: {} })),
          ],
          edges: event.artifact.executionReceiptIds.map((id) => ({ from: `receipt:${id}`, to: event.artifact.artifactId, relation: "produced" as const })),
        },
      });
      return;
    }

    if (event.type === "plan") {
      await appendLedgerEvent(input.tenant, {
        projectId: input.projectId,
        chatId: input.chatId,
        sessionId: input.sessionId,
        eventType: "execution.planned",
        actorType: "system",
        requestId: input.request.requestId,
        payload: { plan: sanitizeLedgerPayload(event.plan) as Record<string, unknown> },
      });
      return;
    }

    if (event.type === "approval_required") {
      await appendLedgerEvent(input.tenant, {
        projectId: input.projectId,
        chatId: input.chatId,
        sessionId: input.sessionId,
        eventType: "execution.approval",
        actorType: "system",
        requestId: input.request.requestId,
        payload: {
          action: event.action,
          actionRequest: sanitizeLedgerPayload(event.actionRequest),
          choices: event.choices,
          message: event.message,
        },
      });
      return;
    }

    if (event.type === "receipt") {
      const receipt = buildReceipt(event.receipt);
      await appendLedgerEvent(input.tenant, {
        projectId: input.projectId,
        chatId: input.chatId,
        sessionId: input.sessionId,
        eventType: "execution.receipt",
        actorType: event.receipt.aiDerived ? "ai" : "engine",
        requestId: input.request.requestId,
        receiptId: event.receipt.id,
        payload: { receipt: receipt as unknown as Record<string, unknown> },
        lineage: receipt.lineage,
      });
      return;
    }

    if (event.type === "trust") {
      const trustRef = `evidence:${event.manifest.trustId}`;
      const evidenceNodes = event.manifest.evidence.map((item) => ({
        kind: "source" as const,
        ref: item.sourceRef,
        version: null,
        hash: item.valueHash,
        asOf: item.asOf,
        metadata: {
          providerId: item.providerId,
          providerLabel: item.providerLabel,
          freshness: item.freshness,
          quality: item.quality,
          confidence: item.confidence,
          connectorState: item.connectorState,
          isFallback: item.isFallback,
          fields: item.fields,
        },
      }));
      const receiptNodes = event.manifest.claims.flatMap((claim) => claim.receiptIds)
        .filter((id, index, all) => all.indexOf(id) === index)
        .map((id) => ({
          kind: "execution" as const,
          ref: `receipt:${id}`,
          version: "1",
          hash: null,
          asOf: null,
          metadata: {},
        }));
      await appendLedgerEvent(input.tenant, {
        projectId: input.projectId,
        chatId: input.chatId,
        sessionId: input.sessionId,
        eventType: "evidence.assessed",
        actorType: "system",
        requestId: input.request.requestId,
        payload: {
          trustManifest: sanitizeLedgerPayload(event.manifest) as Record<string, unknown>,
        },
        lineage: {
          nodes: [
            {
              kind: "evidence",
              ref: trustRef,
              version: event.manifest.schemaVersion,
              hash: hashLedgerValue(event.manifest),
              asOf: event.manifest.generatedAt,
              metadata: {
                freshness: event.manifest.summary.freshness,
                quality: event.manifest.summary.quality,
                confidence: event.manifest.summary.confidence,
                conflictState: event.manifest.summary.conflictState,
                evidenceCoveragePct: event.manifest.summary.evidenceCoveragePct,
              },
            },
            ...evidenceNodes,
            ...receiptNodes,
          ],
          edges: [
            ...event.manifest.evidence.map((item) => ({ from: item.sourceRef, to: trustRef, relation: "supports" as const })),
            ...receiptNodes.map((item) => ({ from: item.ref, to: trustRef, relation: "supports" as const })),
            ...event.manifest.conflicts.flatMap((conflict) => conflict.sourceRefs.map((sourceRef) => ({
              from: sourceRef,
              to: trustRef,
              relation: "conflicts_with" as const,
            }))),
          ],
        },
      });
      return;
    }

    if (event.type === "error") {
      failedRecorded = true;
      await appendLedgerEvent(input.tenant, {
        projectId: input.projectId,
        chatId: input.chatId,
        sessionId: input.sessionId,
        eventType: "conversation.failed",
        actorType: "system",
        requestId: input.request.requestId,
        payload: { code: event.code, message: event.message },
      });
      return;
    }

    if (event.type === "done" && event.status === "completed") {
      await appendLedgerEvent(input.tenant, {
        projectId: input.projectId,
        chatId: input.chatId,
        sessionId: input.sessionId,
        eventType: "conversation.completed",
        actorType: "system",
        requestId: input.request.requestId,
        payload: { status: event.status },
      });
      return;
    }

    if (event.type === "done" && (event.status === "cancelled" || event.status === "failed") && !failedRecorded) {
      failedRecorded = true;
      await appendLedgerEvent(input.tenant, {
        projectId: input.projectId,
        chatId: input.chatId,
        sessionId: input.sessionId,
        eventType: "conversation.failed",
        actorType: "system",
        requestId: input.request.requestId,
        payload: { status: event.status },
      });
    }
  }

  return { recordRequest, recordRuntimeEvent };
}
