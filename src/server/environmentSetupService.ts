import { desc, eq } from "drizzle-orm";
import crypto from "crypto";
import { getDb } from "./db";
import { recordAuditEvent, auditActor } from "./auditEvents";
import { getUserScopedConnectorRegistrySnapshot } from "./connectorService";
import { BUILT_IN_CONNECTORS, type ConnectorRegistrySnapshot } from "@shared/connectorRegistry";
import { normalizeProviderId } from "./byoaiRouter";
import {
  environmentSetups,
  type EnvironmentSetup,
  type UpdateEnvironmentSetup,
} from "@shared/schema";
import { normalizeProviderStackOrder } from "./dataStackService";
import { type DataStackPin, type CreateDataStackPinInput, parseDataStackPins } from "@shared/dataStackPins";

export interface EnvironmentSetupStatus {
  setupNeeded: boolean;
  setup: EnvironmentSetup | null;
  connectors: ConnectorRegistrySnapshot;
}
export function validateConnectorIds(ids: string[]): string[] {
  const known = new Set(BUILT_IN_CONNECTORS.map((connector) => connector.id));
  return Array.from(new Set(ids.filter((id) => known.has(id))));
}

export function normalizeSetupAiProviderId(value: string | null | undefined): string | null {
  if (value === null || value === undefined || !value.trim()) return null;
  const normalized = normalizeProviderId(value);
  if (!normalized) throw new Error(`Unsupported AI provider "${value}".`);
  return normalized;
}

export function requiresInitialAiVerification(
  existing: Pick<EnvironmentSetup, "completedAt"> | null,
  input: Pick<UpdateEnvironmentSetup, "complete" | "aiProviderId">,
): boolean {
  if (!input.complete || existing?.completedAt) return false;
  return normalizeSetupAiProviderId(input.aiProviderId) !== null;
}

export async function getEnvironmentSetupStatus(userId: number): Promise<EnvironmentSetupStatus> {
  const db = getDb();
  const [setup] = await db.select().from(environmentSetups).where(eq(environmentSetups.userId, userId)).orderBy(desc(environmentSetups.updatedAt)).limit(1);
  const connectors = await getUserScopedConnectorRegistrySnapshot();
  return { setupNeeded: !setup?.completedAt, setup: setup ?? null, connectors };
}

export async function updateEnvironmentSetup(
  userId: number,
  organizationId: number | null,
  input: UpdateEnvironmentSetup,
  actor: { id: number; email: string },
): Promise<EnvironmentSetup> {
  const db = getDb();
  const now = new Date();
  const selectedConnectorIds = validateConnectorIds(input.selectedConnectorIds);
  const aiProviderId = normalizeSetupAiProviderId(input.aiProviderId);
  const completedAt = input.complete ? now : null;
  const [existing] = await db.select().from(environmentSetups).where(eq(environmentSetups.userId, userId)).limit(1);
  const providerStackOrder = normalizeProviderStackOrder(
    input.providerStackOrder ?? existing?.providerStackOrder ?? selectedConnectorIds,
    selectedConnectorIds,
  );

  const [setup] = await db.insert(environmentSetups).values({
    userId,
    organizationId,
    selectedConnectorIds,
    providerStackOrder,
    pythonRuntimeId: input.pythonRuntimeId,
    pythonEnvironmentPath: input.pythonEnvironmentPath ?? null,
    pythonPackIds: input.pythonPackIds,
    aiProviderId,
    aiModelId: input.aiModelId ?? null,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: environmentSetups.userId,
    set: {
      organizationId,
      selectedConnectorIds,
      providerStackOrder,
      pythonRuntimeId: input.pythonRuntimeId,
      pythonEnvironmentPath: input.pythonEnvironmentPath ?? null,
      pythonPackIds: input.pythonPackIds,
      aiProviderId,
      aiModelId: input.aiModelId ?? null,
      completedAt,
      updatedAt: now,
    },
  }).returning();

  await recordAuditEvent(actor.id, input.complete ? "environment_setup_completed" : "environment_setup_saved", {
    setupId: setup.id,
    organizationId,
    selectedConnectorIds,
    pythonRuntimeId: input.pythonRuntimeId,
    pythonPackIds: input.pythonPackIds,
    aiProviderId,
    aiModelId: input.aiModelId ?? null,
    ...auditActor(actor),
  });
  return setup;
}

export async function getEnvironmentSetupForUser(userId: number): Promise<EnvironmentSetup | null> {
  const db = getDb();
  const [setup] = await db.select().from(environmentSetups).where(eq(environmentSetups.userId, userId)).limit(1);
  return setup ?? null;
}

// ─── Conflict pins (P0.3) ───────────────────────────────────────────────
// Deliberately its own read-modify-write path rather than folded into
// updateEnvironmentSetup: a pin is added/removed from wherever a user is
// looking at a conflict (Advanced/Data-truth surfaces), one at a time, far
// more often than the whole environment setup form is resubmitted --
// routing it through the same bulk-save endpoint would mean two pin edits
// racing each other (or a pin edit racing an unrelated setup save) could
// silently clobber one another's JSONB array write.

export async function listDataStackPins(userId: number): Promise<DataStackPin[]> {
  const setup = await getEnvironmentSetupForUser(userId);
  return parseDataStackPins(setup?.dataStackPins ?? []);
}

export async function addDataStackPin(
  userId: number,
  organizationId: number | null,
  input: CreateDataStackPinInput,
  actor: { id: number; email: string },
): Promise<DataStackPin> {
  const db = getDb();
  const now = new Date();
  const [existing] = await db.select().from(environmentSetups).where(eq(environmentSetups.userId, userId)).limit(1);
  const currentPins = parseDataStackPins(existing?.dataStackPins ?? []);

  const pin: DataStackPin = {
    id: crypto.randomUUID(),
    scope: input.scope,
    family: input.family,
    symbol: input.symbol ? input.symbol.trim().toUpperCase() : null,
    metric: input.metric,
    providerId: input.providerId,
    reason: input.reason,
    createdAt: now.toISOString(),
    createdByUserId: userId,
  };

  // A second pin at the exact same (scope, family, symbol, metric) target
  // replaces the first rather than stacking -- two pins at identical
  // specificity would just be resolved by findPin's tie-break (most
  // recent wins), which is confusing to show a user as "you have two
  // pins here" when only the newest one is ever actually honored.
  const nextPins = [
    ...currentPins.filter((p) => !(p.scope === pin.scope && p.family === pin.family && p.symbol === pin.symbol && p.metric === pin.metric)),
    pin,
  ];

  if (existing) {
    await db.update(environmentSetups).set({ dataStackPins: nextPins, updatedAt: now }).where(eq(environmentSetups.userId, userId));
  } else {
    // No setup row yet (user has never completed environment setup) --
    // create a baseline row; every other NOT NULL column has a schema
    // default (see shared/schema.ts) so a partial insert is safe.
    await db.insert(environmentSetups).values({ userId, organizationId, dataStackPins: nextPins, updatedAt: now })
      .onConflictDoUpdate({ target: environmentSetups.userId, set: { dataStackPins: nextPins, updatedAt: now } });
  }

  await recordAuditEvent(actor.id, "data_stack_pin_created", {
    pinId: pin.id, scope: pin.scope, family: pin.family, symbol: pin.symbol, metric: pin.metric, providerId: pin.providerId,
    ...auditActor(actor),
  });
  return pin;
}

/** Returns false (not an error) when the pin id doesn't exist for this
 * user -- either already removed or never existed, both of which are a
 * no-op from the caller's point of view, not a failure. */
export async function removeDataStackPin(userId: number, pinId: string, actor: { id: number; email: string }): Promise<boolean> {
  const setup = await getEnvironmentSetupForUser(userId);
  if (!setup) return false;
  const currentPins = parseDataStackPins(setup.dataStackPins ?? []);
  const nextPins = currentPins.filter((p) => p.id !== pinId);
  if (nextPins.length === currentPins.length) return false;
  await getDb().update(environmentSetups).set({ dataStackPins: nextPins, updatedAt: new Date() }).where(eq(environmentSetups.userId, userId));
  await recordAuditEvent(actor.id, "data_stack_pin_removed", { pinId, ...auditActor(actor) });
  return true;
}
