/** Durable Wave E state under the existing tenant-scoped preference boundary. */
import { eq } from "drizzle-orm";
import { userPersonaPreferences } from "@shared/schema";
import { withUserTransaction } from "./tenantDb";
import type { PersonaPreferenceUser } from "./personaPreferenceService";
import { boundedWaveEState, EMPTY_WAVE_E_STATE, normalizeWaveEState, type WaveEStoredState } from "@shared/waveEContracts";

function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }

export async function getWaveEState(user: PersonaPreferenceUser): Promise<WaveEStoredState> {
  return withUserTransaction({ userId: user.id, organizationId: user.organizationId, role: user.role }, async (tx) => {
    const [row] = await tx.select({ preferences: userPersonaPreferences.preferences })
      .from(userPersonaPreferences)
      .where(eq(userPersonaPreferences.userId, user.id))
      .limit(1);
    const preferences = isRecord(row?.preferences) ? row.preferences : {};
    return normalizeWaveEState(preferences.waveE);
  });
}

export async function updateWaveEState(user: PersonaPreferenceUser, update: (current: WaveEStoredState) => WaveEStoredState): Promise<WaveEStoredState> {
  return withUserTransaction({ userId: user.id, organizationId: user.organizationId, role: user.role }, async (tx) => {
    const [row] = await tx.select().from(userPersonaPreferences)
      .where(eq(userPersonaPreferences.userId, user.id))
      .limit(1);
    const currentPreferences = isRecord(row?.preferences) ? row.preferences : {};
    const current = normalizeWaveEState(currentPreferences.waveE ?? EMPTY_WAVE_E_STATE);
    const next = boundedWaveEState({ ...update(current), updatedAt: new Date().toISOString() });
    const preferences = { ...currentPreferences, waveE: next };
    if (row) await tx.update(userPersonaPreferences).set({ preferences, updatedAt: new Date() }).where(eq(userPersonaPreferences.userId, user.id));
    else await tx.insert(userPersonaPreferences).values({ userId: user.id, organizationId: user.organizationId, preferences });
    return next;
  });
}
