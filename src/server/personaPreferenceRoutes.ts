import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import {
  getPersonaPreferences,
  PersonaPreferenceError,
  personaPreferencePatchSchema,
  upsertPersonaPreferences,
  type PersonaPreferenceUser,
} from "./personaPreferenceService";
import type { SecurityRoleId } from "@shared/personaRegistry";

export function authenticatedUser(req: Request): PersonaPreferenceUser {
  const user = req.user;
  if (!user) throw new PersonaPreferenceError("Authentication is required.", "invalid_user");
  return {
    id: user.id,
    email: user.email,
    role: user.role as SecurityRoleId,
    organizationId: user.organizationId,
  };
}

export function personaPreferenceErrorStatus(code: PersonaPreferenceError["code"]): number {
  return code === "invalid_user" ? 403 : 422;
}


function sendServiceError(res: Response, error: unknown): void {
  if (error instanceof PersonaPreferenceError) {
    res.status(personaPreferenceErrorStatus(error.code)).json({ error: error.message, code: error.code });
    return;
  }
  console.error("[personaPreferences] request failed:", error);
  res.status(500).json({ error: "Unable to load persona preferences." });
}

export function registerPersonaPreferenceRoutes(app: Express): void {
  app.get("/api/me/persona-preferences", requireAuth, async (req, res) => {
    try {
      res.json(await getPersonaPreferences(authenticatedUser(req)));
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  const update = async (req: Request, res: Response): Promise<void> => {
    const parsed = personaPreferencePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid persona preferences.", details: parsed.error.flatten() });
      return;
    }
    try {
      res.json(await upsertPersonaPreferences(authenticatedUser(req), parsed.data));
    } catch (error) {
      sendServiceError(res, error);
    }
  };

  app.patch("/api/me/persona-preferences", requireAuth, update);
  app.put("/api/me/persona-preferences", requireAuth, update);
}
