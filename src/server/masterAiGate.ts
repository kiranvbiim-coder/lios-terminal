import type { Request, Response } from "express";
import { normalizeMasterAiSessionState } from "@shared/waveCContracts";
import { getPersonaPreferences, type PersonaPreferenceUser } from "./personaPreferenceService";

const ASK_LIOS_OFF_ERROR = "Ask LiOS is off for this account. Turn Master AI on to use chat. Deterministic Workbench tools remain available.";

export async function requireMasterAiOn(user: PersonaPreferenceUser): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
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
    return { ok: true };
  } catch (error) {
    return { ok: false, status: 503, error: error instanceof Error ? error.message : "Master AI state is unavailable." };
  }
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
