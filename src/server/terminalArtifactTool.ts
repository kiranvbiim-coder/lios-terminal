import { z } from "zod";
import { terminalArtifactUpdateSchema, applyTerminalArtifactOperations } from "@shared/terminalArtifactOperations";
import { readTerminalScreenState } from "@shared/terminalArtifact";
import { terminalExecutionTargetSchema, type TerminalExecutionTarget } from "@shared/terminalArtifact";
import { getProject } from "./projectStore";
import { artifactContentSchema } from "@shared/artifactContracts";
import { getArtifact, getArtifactVersion, createArtifactVersion } from "./artifactStore";
import { getProjectChat } from "./projectChatStore";
import { tenantContext, type TenantContext } from "./tenantContext";
import { hashLedgerValue } from "./ledgerStore";
import { assertNotAborted } from "./conversationRuntimeCore";
import type { ConversationToolDefinition } from "./conversationRuntime";
import { getEntitlementPolicyById } from "./dataEntitlementStore";
import { and, eq, isNull } from "drizzle-orm";
import { portfolios, datasetSnapshots, users } from "@shared/schema";
import { getDb, type DrizzleDb } from "./db";
import { canonicalSnapshotColumnSchema, type ResolvedAdvancedQuantInputProvenance } from "@shared/quantModelRegistry";
import { canAccessDatasetSnapshot, flattenSnapshotForColumnar } from "./columnarArtifactStore";
import { requirePythonInputFields } from "./pythonInputContract";
import { economicSnapshotContentHash } from "./economicDatasetStore";

export async function validateTerminalArtifactTarget(ctx: TenantContext, chatId: number, binding: { artifactId: string; version: number; contentHash: string }, signal: AbortSignal) {
  assertNotAborted(signal);
  const chat = await getProjectChat(ctx, chatId);
  const artifact = await getArtifact(ctx, binding.artifactId);
  if (artifact.ownerUserId !== ctx.userId || artifact.status !== "active" || artifact.projectId !== chat.projectId || (artifact.projectId === null && artifact.owningChatId !== chatId)) throw new Error("Select a terminal Artifact owned by this Chat or Project.");
  if (artifact.headVersion !== binding.version) throw new Error("Selected terminal Artifact changed; reload before model planning.");
  const version = await getArtifactVersion(ctx, binding.artifactId, binding.version);
  const content = artifactContentSchema.parse(version.content);
  if (version.contentHash !== binding.contentHash || hashLedgerValue(content) !== binding.contentHash || content.kind !== "screen" || !readTerminalScreenState(content.state)) throw new Error("Selected terminal Artifact revision binding is invalid.");
  assertNotAborted(signal);
  return { artifact, version };
}

/** Validate an explicit original-panel native Run before starting numerical work. */
export async function validateTerminalExecutionTarget(ctx: TenantContext, raw: TerminalExecutionTarget, signal: AbortSignal) {
  const target = terminalExecutionTargetSchema.parse(raw);
  assertNotAborted(signal);
  const [actor] = await getDb().select({ id: users.id }).from(users).where(and(eq(users.id, ctx.userId), eq(users.active, true), eq(users.role, ctx.role),
    ctx.organizationId === null ? isNull(users.organizationId) : eq(users.organizationId, ctx.organizationId))).limit(1);
  if (!actor || !["internal_admin", "internal_analyst"].includes(ctx.role)) throw new Error("Current native model author access changed.");
  const artifact = await getArtifact(ctx, target.artifactId);
  if (artifact.projectId === null) {
    if (!artifact.owningChatId) throw new Error("Select an existing owned persistent terminal Chat.");
    await validateTerminalArtifactTarget(ctx, artifact.owningChatId, { artifactId: target.artifactId, version: target.baseVersion, contentHash: target.baseHash }, signal);
  } else {
    await getProject(ctx, artifact.projectId);
    if (artifact.ownerUserId !== ctx.userId || artifact.status !== "active" || artifact.headVersion !== target.baseVersion) throw new Error("Terminal Artifact changed; reopen its current owned revision.");
  }
  const version = await getArtifactVersion(ctx, artifact.id, target.baseVersion);
  if (version.contentHash !== target.baseHash) throw new Error("Terminal Artifact native target hash changed.");
  const content = artifactContentSchema.parse(version.content);
  const state = content.kind === "screen" ? readTerminalScreenState(content.state) : null;
  if (!state || hashLedgerValue({ ...state, panelState: {} }) !== hashLedgerValue({ ...target.authoredState, panelState: {} })) throw new Error("Native calculation cannot change terminal subject, source, scenario or time posture.");
  for (const ref of [...version.sourceRefs, ...(version.dependencyRefs ?? [])]) {
    if (!ref.startsWith("entitlement-policy:")) continue;
    const policy = await getEntitlementPolicyById(ref.slice("entitlement-policy:".length));
    const now = new Date();
    if (!policy || policy.effectiveFrom > now || policy.effectiveTo !== null && policy.effectiveTo <= now || !policy.permittedUses.includes("display")) throw new Error("Current rights no longer permit this terminal source.");
  }
  assertNotAborted(signal);
}

/** Admit actual immutable source values, never source IDs supplied only as declarations. */
export async function admitTerminalExecutionSources(ctx: TenantContext, provenance: ResolvedAdvancedQuantInputProvenance, parameters: Record<string, unknown>, db: Pick<DrizzleDb, "select"> = getDb(), lock = false, requiredUses: readonly string[] = ["display", "model_input", "derived_output"], modelPath?: string): Promise<string[]> {
  if (provenance.dataClassification === "manual" || provenance.dataClassification === "synthetic") return [];
  if (provenance.dataClassification === "model_derived") throw new Error("A model-derived native run requires an admitted persisted upstream model adapter.");
  if (!modelPath) throw new Error("Source-bound native runs require the selected engine input contract.");
  if (!lock && requiredUses.includes("model_input")) await requirePythonInputFields(`/advanced/${modelPath}`, (provenance.sourceBindings ?? []).flatMap(binding => binding.field === "manual-import" ? Object.keys(parameters) : [binding.field.split(".")[0]]));
  const refs: string[] = [];
  for (const binding of provenance.sourceBindings ?? []) {
    const metadataQuery = db.select({ id: datasetSnapshots.id, organizationId: datasetSnapshots.organizationId, createdByUserId: datasetSnapshots.createdByUserId,
      provider: datasetSnapshots.provider, dataClass: datasetSnapshots.dataClass, contentHash: datasetSnapshots.contentHash,
      entitlementPolicyId: datasetSnapshots.entitlementPolicyId, availableAt: datasetSnapshots.availableAt, expiresAt: datasetSnapshots.expiresAt }).from(datasetSnapshots).where(eq(datasetSnapshots.id, binding.snapshot.id));
    const [source] = await (lock ? metadataQuery.for("share") : metadataQuery).limit(1);
    const now = new Date();
    if (!source || !canAccessDatasetSnapshot(source, ctx) || source.contentHash !== binding.snapshot.contentHash || source.provider !== binding.provider
      || source.availableAt > now || source.expiresAt !== null && source.expiresAt <= now) throw new Error("Native source snapshot is unavailable or outside the current tenant.");
    const policy = source.entitlementPolicyId ? await getEntitlementPolicyById(source.entitlementPolicyId, db, lock) : null;
    if (!policy || policy.licenseType === "unknown" || policy.provider !== source.provider || policy.dataClass !== source.dataClass || policy.effectiveFrom > now || policy.effectiveTo !== null && policy.effectiveTo <= now
      || policy.accessScope === "internal_only" && !ctx.role.startsWith("internal_")
      || !requiredUses.every(use => policy.permittedUses.includes(use))) throw new Error("Current source rights do not permit this native calculation and retained result.");
    const column = binding.transformations.length === 1 && binding.transformations[0].startsWith("canonical-column:")
      ? canonicalSnapshotColumnSchema.parse(JSON.parse(binding.transformations[0].slice("canonical-column:".length))) : null;
    if (provenance.transformations.length || binding.transformations.length && !column) throw new Error("Source transformations require an explicit admitted engine input adapter.");
    const [snapshot] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.id, source.id)).limit(1);
    const expectedHash = source.dataClass === "economic_series" || source.dataClass === "yield_curve"
      ? economicSnapshotContentHash(snapshot?.payload, snapshot?.lineage)
      : snapshot ? hashLedgerValue({ payload: snapshot.payload, provider: snapshot.provider, lineage: snapshot.lineage }) : null;
    if (!snapshot || expectedHash !== source.contentHash) throw new Error("Native source content does not match its immutable hash.");
    const parts = binding.field.split(".");
    if (binding.field !== "manual-import" && !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(binding.field)) throw new Error("Source bindings require an exact top-level consumed engine parameter; nested paths require an admitted request-model adapter.");
    if (parts.some(part => ["__proto__", "prototype", "constructor"].includes(part))) throw new Error("Unsafe native source field.");
    const read = (value: unknown) => parts.reduce<unknown>((next, key) => next && typeof next === "object" && Object.hasOwn(next, key) ? (next as Record<string, unknown>)[key] : undefined, value);
    let sourceValue: unknown = binding.field === "manual-import" ? snapshot.payload : read(snapshot.payload);
    if (column) {
      const flattened = flattenSnapshotForColumnar(snapshot);
      if (!flattened.numericColumns.includes(column.field) || column.rowsWhereFinite && !flattened.numericColumns.includes(column.rowsWhereFinite)) throw new Error("Source adapter requires canonical numeric snapshot columns.");
      const rows = column.rowsWhereFinite ? flattened.records.filter(row => typeof row[column.rowsWhereFinite!] === "number" && Number.isFinite(row[column.rowsWhereFinite!] as number)) : flattened.records;
      if (!rows.length) throw new Error("Source adapter has no selected observations.");
      const selected = column.selection === "last" ? [rows[rows.length - 1]] : rows;
      const values = selected.map(row => row[column.field]);
      if (values.some(value => typeof value !== "number" || !Number.isFinite(value))) throw new Error("Source adapter refuses missing/non-finite selected observations.");
      const scaled = (values as number[]).map(value => value * column.scale);
      if (scaled.some(value => !Number.isFinite(value))) throw new Error("Source adapter scale produced non-finite input.");
      sourceValue = column.selection === "last" ? scaled[0] : scaled;
    }
    const inputValue = binding.field === "manual-import" ? parameters : read(parameters);
    if (sourceValue === undefined || inputValue === undefined || hashLedgerValue(sourceValue) !== hashLedgerValue(inputValue)) throw new Error("Native source fields do not match actual engine inputs; use an admitted transformation adapter.");
    refs.push(`dataset-snapshot:${source.id}`, `dataset-content-sha256:${source.contentHash}`, `entitlement-policy:${policy.id}`);
  }
  if (!refs.length) throw new Error("Source-bound native execution requires admitted immutable inputs.");
  return [...new Set(refs)];
}
export async function updateTerminalArtifact(ctx: TenantContext, chatId: number, raw: unknown, signal: AbortSignal) {
  const input = terminalArtifactUpdateSchema.parse(raw);
  assertNotAborted(signal);
  const chat = await getProjectChat(ctx, chatId);
  const artifact = await getArtifact(ctx, input.artifactId);
  if (artifact.ownerUserId !== ctx.userId || artifact.status !== "active" || artifact.projectId !== chat.projectId || (artifact.projectId === null && artifact.owningChatId !== chatId)) throw new Error("Select a terminal Artifact owned by this Chat or Project.");
  if (artifact.headVersion !== input.baseVersion) throw new Error("Terminal Artifact changed. Reload its current revision before applying an operation.");
  const version = await getArtifactVersion(ctx, artifact.id, input.baseVersion);
  const content = artifactContentSchema.parse(version.content);
  if (version.contentHash !== input.baseHash || hashLedgerValue(content) !== version.contentHash) throw new Error("Terminal Artifact base hash does not match the selected immutable revision.");
  if (content.kind !== "screen") throw new Error("This operation requires the selected interactive terminal Artifact.");
  const terminal = readTerminalScreenState(content.state);
  if (!terminal) throw new Error("This screen has no retained analytical terminal state.");
  for (const ref of [...version.sourceRefs, ...(version.dependencyRefs ?? [])]) {
    if (!ref.startsWith("entitlement-policy:")) continue;
    const policy = await getEntitlementPolicyById(ref.slice("entitlement-policy:".length));
    const now = new Date();
    if (!policy || policy.effectiveFrom > now || policy.effectiveTo !== null && policy.effectiveTo <= now || !policy.permittedUses.includes("display")) throw new Error("Current source rights no longer permit this terminal view.");
  }
  const nextState = applyTerminalArtifactOperations(content.view, terminal, input.operations);
  for (const operation of input.operations) if (operation.type === "portfolio.select" && operation.portfolioId !== null) {
    if (!ctx.role.startsWith("internal_")) throw new Error("This portfolio stress selector requires the existing internal portfolio role.");
    const [portfolio] = await getDb().select().from(portfolios).where(eq(portfolios.id, operation.portfolioId)).limit(1);
    if (!portfolio) throw new Error("Selected portfolio is not available.");
    nextState.panelState["PortfolioStressPanel.orgId"] = portfolio.organizationId;
  }
  const next = { ...content, state: { ...content.state, terminal: nextState } };
  if (hashLedgerValue(next) === version.contentHash) return { status: "unchanged" as const, artifactId: artifact.id, version: version.version, contentHash: version.contentHash };
  assertNotAborted(signal);
  const saved = await createArtifactVersion(ctx, { artifactId: artifact.id, baseVersion: input.baseVersion, content: next, actorType: "conversation", note: "Applied typed terminal presentation/input operation. No market observations or numerical outputs were fabricated." });
  return { status: "applied" as const, artifactId: artifact.id, version: saved.version, contentHash: saved.contentHash };
}
const tenantSchema = z.object({ userId: z.number().int().positive(), organizationId: z.number().int().positive().nullable(), role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]) });
export const terminalArtifactTool: ConversationToolDefinition = {
  id: "lios.artifact.terminal_update", label: "Operate selected existing financial terminal Artifact",
  kind: "calculate", permissionClass: "safe_auto", access: "write", sideEffect: "internal_write", replaySafe: false,
  planningHint: "Apply typed chart/screener settings or selections to the SELECTED retained terminal screen. Supply exact artifactId,baseVersion,baseHash and operations. No financial result calculation, source snapshot creation or arbitrary state patches. Current immutable base and Chat ownership are required.",
  inputSchema: terminalArtifactUpdateSchema,
  outputSchema: z.object({ output: z.object({ status: z.enum(["applied", "unchanged"]), artifactId: z.string(), version: z.number(), contentHash: z.string() }), summary: z.string(), deterministic: z.boolean(), sourceRefs: z.array(z.string()) }),
  maxOutputBytes: 4096, cancel: null,
  invoke: async (raw, signal, call) => {
    const parsed = terminalArtifactUpdateSchema.parse(raw);
    if (parsed.operations.some(operation => operation.type === "valuation.assumptions")) throw new Error("Material valuation assumptions require an explicit user instruction through the reviewed Chat input path, not an autonomous presentation operation.");
    const tenant = tenantSchema.parse(call.tenant);
    if (call.source !== "agent" || call.userId !== tenant.userId || !call.chatId || !call.requestId || !call.activeArtifactRefs?.includes(parsed.artifactId)) throw new Error("Terminal operations require a trusted active Chat and selected Artifact target.");
    const binding = call.terminalArtifact;
    if (call.resourceTransmissionAllowed !== true || !binding || binding.artifactId !== parsed.artifactId || binding.version !== parsed.baseVersion || binding.contentHash !== parsed.baseHash) throw new Error("Terminal operation must match the user's exact selected immutable revision and transmission policy.");
    const result = await updateTerminalArtifact(tenantContext({ id: tenant.userId, organizationId: tenant.organizationId, role: tenant.role }), call.chatId, parsed, signal);
    return { output: result, summary: `Terminal state ${result.status} on the same Artifact at v${result.version}. No numerical calculation was claimed.`, deterministic: true, sourceRefs: [] };
  },
};
