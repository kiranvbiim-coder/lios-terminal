import { z } from "zod";

/** These two closed reads do not admit shell, inference or remote subprocesses. */
export const REMOTE_DIAGNOSIS_CAPABILITY = "node.runtime-diagnosis.v1" as const;
export const REMOTE_FINANCE_CAPABILITY = "node.personal-finance-snapshot.v1" as const;
export const REMOTE_OPERATION_TIMEOUT_MS = 10_000;
const id = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const remoteFinanceSourceSchema = z.object({ sourceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/), inputHash: hash }).strict();
export type RemoteFinanceSource = z.infer<typeof remoteFinanceSourceSchema>;
const bindingBase = z.object({ requestId: z.string().uuid(), userId: z.number().int().positive().safe(), deviceId: id, generationId: id, expiresAt: z.string().datetime(), placementDigest: hash.optional() }).strict();
export const remoteDiagnosisBindingSchema = bindingBase.extend({ capability: z.literal(REMOTE_DIAGNOSIS_CAPABILITY) });
export const remoteFinanceBindingSchema = bindingBase.extend({ capability: z.literal(REMOTE_FINANCE_CAPABILITY), source: remoteFinanceSourceSchema });
export const remoteOperationBindingSchema = z.discriminatedUnion("capability", [remoteDiagnosisBindingSchema, remoteFinanceBindingSchema]);
export type RemoteOperationBinding = z.infer<typeof remoteOperationBindingSchema>;
export const remoteDiagnosisReportSchema = z.object({
  platform: z.enum(["aix", "darwin", "freebsd", "linux", "openbsd", "sunos", "win32", "android", "netbsd", "cygwin", "haiku"]),
  architecture: z.string().min(1).max(32), nodeVersion: z.string().min(1).max(64),
  logicalCpuCount: z.number().int().min(0).max(65536), totalMemoryBytes: z.number().int().nonnegative().safe(), freeMemoryBytes: z.number().int().nonnegative().safe(),
  observedAt: z.string().datetime(), execution: z.literal("synchronous-node-os-read-no-subprocess"),
}).strict();
export const remoteFinanceReportSchema = z.object({
  source: remoteFinanceSourceSchema,
  engineId: z.literal("lios.personal-finance.core-v1"), engineVersion: z.literal("1.1.0"), deterministic: z.literal(true), engineInputHash: hash,
  asOf: z.string().date(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  netWorth: z.number().finite(), assets: z.number().finite(), liabilities: z.number().finite(),
  trailingMonthlyIncome: z.number().finite(), trailingMonthlyExpenses: z.number().finite(), trailingMonthlyCashFlow: z.number().finite(), savingsRate: z.number().finite().nullable(),
  warnings: z.array(z.string().max(256)).max(8),
  execution: z.literal("canonical-p6-node-local-read-no-subprocess"),
}).strict();
export type RemoteFinanceReport = z.infer<typeof remoteFinanceReportSchema>;
export const remoteOperationReportSchema = z.union([remoteDiagnosisReportSchema, remoteFinanceReportSchema]);
export const remoteOperationOutcomeSchema = z.object({
  binding: remoteOperationBindingSchema, status: z.enum(["completed", "failed"]), outcome: z.enum(["remote-reported", "not-dispatched", "outcome-unknown"]),
  homeVerified: z.object({ authenticatedDeviceId: id, connectionGenerationId: id, capability: z.enum([REMOTE_DIAGNOSIS_CAPABILITY, REMOTE_FINANCE_CAPABILITY]) }).strict(),
  report: remoteOperationReportSchema.nullable(), reason: z.enum(["reported", "disconnected", "authority-changed", "timeout", "source-unavailable", "placement-changed"]),
  independentHardwareVerification: z.literal(false),
}).strict();
export type RemoteOperationOutcome = z.infer<typeof remoteOperationOutcomeSchema>;
const target = z.object({ deviceId: id, generationId: id }).strict();
const diagnosisTarget = target.extend({ capability: z.literal(REMOTE_DIAGNOSIS_CAPABILITY) });
const financeTarget = target.extend({ capability: z.literal(REMOTE_FINANCE_CAPABILITY), source: remoteFinanceSourceSchema });
const placementPolicyBase = z.object({
  approvedDeviceIds: z.array(id).min(1).max(32),
  hardware: z.object({
    minimumFreeMemoryBytes: z.number().int().nonnegative().safe(),
    maxAgeMs: z.number().int().min(1).max(30_000),
    evidence: z.enum(["remote-reported", "independent-attestation"]),
  }).strict().nullable(),
}).strict();
export const remoteNodePlacementPolicySchema = z.discriminatedUnion("capability", [
  placementPolicyBase.extend({ capability: z.literal(REMOTE_DIAGNOSIS_CAPABILITY) }),
  placementPolicyBase.extend({ capability: z.literal(REMOTE_FINANCE_CAPABILITY), source: remoteFinanceSourceSchema }),
]);
export type RemoteNodePlacementPolicy = z.infer<typeof remoteNodePlacementPolicySchema>;
export const remoteNodeHardwareEvidenceSchema = z.object({
  requestId: z.string().uuid(), generationId: id, receivedAt: z.string().datetime(),
  observedAt: z.string().datetime(), freeMemoryBytes: z.number().int().nonnegative().safe(),
  totalMemoryBytes: z.number().int().nonnegative().safe(), reportHash: hash,
  trust: z.literal("remote-reported"),
}).strict();
export type RemoteNodeHardwareEvidence = z.infer<typeof remoteNodeHardwareEvidenceSchema>;
export const remoteNodePlacementSelectionSchema = z.object({
  requestId: z.string().uuid(), userId: z.number().int().positive().safe(), requesterGenerationId: id,
  policy: remoteNodePlacementPolicySchema, policyHash: hash,
  target: z.discriminatedUnion("capability", [diagnosisTarget, financeTarget]),
  selectedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  hardwareEvidence: remoteNodeHardwareEvidenceSchema.nullable(),
  /** Home seal binds selection data only; current device/account authority remains mandatory. */
  signature: hash,
}).strict();
export type RemoteNodePlacementSelection = z.infer<typeof remoteNodePlacementSelectionSchema>;
const placementAdmission = z.object({ policy: remoteNodePlacementPolicySchema, selection: remoteNodePlacementSelectionSchema }).strict();
export const remoteNodeMethods = {
  "node.diagnosis.list": { scope: "read", params: z.object({}).strict(), result: z.object({ nodes: z.array(diagnosisTarget).max(256) }).strict() },
  "node.diagnosis.run": { scope: "read", params: diagnosisTarget.extend({ requestId: z.string().uuid(), placement: placementAdmission.optional() }), result: remoteOperationOutcomeSchema },
  "node.finance.list": { scope: "read", params: z.object({}).strict(), result: z.object({ nodes: z.array(financeTarget).max(256) }).strict() },
  "node.finance.run": { scope: "read", params: financeTarget.extend({ requestId: z.string().uuid(), placement: placementAdmission.optional() }), result: remoteOperationOutcomeSchema },
  "node.operation.select": { scope: "read", params: z.object({ requestId: z.string().uuid(), policy: remoteNodePlacementPolicySchema }).strict(), result: remoteNodePlacementSelectionSchema },
  "node.operation.poll": { scope: "read", params: z.object({ capability: z.literal(REMOTE_DIAGNOSIS_CAPABILITY), financeSources: z.array(remoteFinanceSourceSchema).max(1).default([]) }).strict(), result: z.object({ generationId: id, operation: remoteOperationBindingSchema.nullable() }).strict() },
  "node.operation.result": { scope: "read", params: z.object({ binding: remoteOperationBindingSchema, report: remoteOperationReportSchema.nullable(), failure: z.literal("source-unavailable").optional() }).strict(), result: z.object({ accepted: z.literal(true) }).strict() },
} as const;
