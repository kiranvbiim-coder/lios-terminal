import type { Request, Response } from "express";
import { normalizeMasterAiSessionState } from "@shared/waveCContracts";
import { getPersonaPreferences, setMasterAiPreference, type PersonaPreferenceUser } from "./personaPreferenceService";
import { getEnvironmentSetupForUser } from "./environmentSetupService";
import { hasVerifiedAIChatSelection, verifiedAIChatSelectionAttempt } from "./aiProviderVerification";
import { getDb } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { assertCurrentCredentialSnapshot } from "./credentialVault";
import { getProviderConfig } from "./byoaiRouter";
const ASK_LIOS_OFF_ERROR = "Ask LiOS is off for this account. Turn Master AI on to use chat. Deterministic Workbench tools remain available.";

const authorizationRevisions = new Map<number, number>();
export const masterAiAuthorizationGeneration = randomUUID();
export function masterAiAuthorizationRevision(userId: number): number {
  return authorizationRevisions.get(userId) ?? 0;
}
export function advanceMasterAiAuthorizationRevision(userId: number): number {
  const revision = masterAiAuthorizationRevision(userId) + 1;
  authorizationRevisions.set(userId, revision);
  return revision;
}

/** Configuration edits/revocation never leave account permission enabled for a different AI identity. */
export async function turnMasterAiOff(user: PersonaPreferenceUser, modeOverride?: "manual" | "ai_assist" | "ai_build" | "ai_scenario"): Promise<void> {
  const revision = advanceMasterAiAuthorizationRevision(user.id);
  const current = await getPersonaPreferences(user);
  const raw = current.preferences.preferences.waveCMasterAi;
  const mode = modeOverride ?? normalizeMasterAiSessionState(raw && typeof raw === "object" ? raw as { mode?: "manual" | "ai_assist" | "ai_build" | "ai_scenario" } : undefined).mode;
  await setMasterAiPreference(user, { state: "off", mode, updatedAt: new Date().toISOString(), authorization: { generation: masterAiAuthorizationGeneration, revision } });
}

export async function requireMasterAiOn(user: PersonaPreferenceUser): Promise<{ ok: true; provider: string; model: string; verificationAttemptId: number } | { ok: false; status: number; error: string }> {
  try {
    const preferences = await getPersonaPreferences(user);
    const raw = preferences.preferences.preferences.waveCMasterAi;
    const aiState = normalizeMasterAiSessionState(
      raw && typeof raw === "object"
        ? raw as { state?: "on" | "off"; mode?: "manual" | "ai_assist" | "ai_build" | "ai_scenario" }
        : undefined,
    );
    if (aiState.state !== "on") {
      return { ok: false, status: 403, error: ASK_LIOS_OFF_ERROR };
    }
    const setup = await getEnvironmentSetupForUser(user.id);
    const providerConfig = setup?.aiProviderId ? getProviderConfig(setup.aiProviderId) : undefined;
    const assertCredentialCurrent = providerConfig ? await assertCurrentCredentialSnapshot(providerConfig.envKey, providerConfig.vaultKey) : null;
    const proofAttemptId = verifiedAIChatSelectionAttempt(user.id, setup?.aiProviderId ?? null, setup?.aiModelId ?? null, user.organizationId);
    const authorization = raw && typeof raw === "object"
      ? (raw as { authorization?: { generation?: string; revision?: number; verificationAttemptId?: number } }).authorization : undefined;
    if (!setup?.aiProviderId || !setup.aiModelId || proofAttemptId === null || authorization?.revision !== masterAiAuthorizationRevision(user.id)
      || authorization.generation !== masterAiAuthorizationGeneration || authorization.verificationAttemptId !== proofAttemptId) {
      return { ok: false, status: 403, error: "The saved AI selection is no longer verified. Explicitly test it in Connections before enabling AI." };
    }
    assertCredentialCurrent?.();
    return { ok: true, provider: setup.aiProviderId, model: setup.aiModelId, verificationAttemptId: proofAttemptId };
  } catch (error) {
    return { ok: false, status: 503, error: error instanceof Error ? error.message : "Master AI state is unavailable." };
  }
}

/** Rechecked after metadata/source-policy awaits, immediately before dispatch. */
export async function requireMasterAiDispatchOn(userId: number, organizationId: number | null, provider: string, model: string, localModelIdentity?: string): Promise<() => void> {
  const revision = masterAiAuthorizationRevision(userId);
  const [user] = await getDb().select({ id: users.id, email: users.email, role: users.role, organizationId: users.organizationId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.organizationId !== organizationId) throw new Error("The AI account identity is no longer available.");
  const gate = await requireMasterAiOn({ id: user.id, email: user.email, role: user.role as PersonaPreferenceUser["role"], organizationId });
  if (!gate.ok) throw new Error(gate.error);
  if (gate.provider !== provider || gate.model !== model) throw new Error("The dispatch target differs from the explicitly enabled AI selection.");
  const proofAttemptId = gate.verificationAttemptId;
  const assertCurrent = () => {
    if (revision !== masterAiAuthorizationRevision(userId)
      || proofAttemptId === null || verifiedAIChatSelectionAttempt(userId, provider, model, organizationId) !== proofAttemptId
      || !hasVerifiedAIChatSelection(userId, provider, model, organizationId, localModelIdentity)) {
      throw new Error("AI authorization or the verified selection changed before dispatch.");
    }
  };
  assertCurrent();
  return assertCurrent;
}

export function personaUserFromRequest(req: Request): PersonaPreferenceUser {
  return {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role as PersonaPreferenceUser["role"],
    organizationId: req.user!.organizationId,
  };
}

export async function rejectIfMasterAiOff(req: Request, res: Response): Promise<boolean> {
  const gate = await requireMasterAiOn(personaUserFromRequest(req));
  if (gate.ok) return false;
  res.status(gate.status).json({ error: gate.error });
  return true;
}
