import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CLIENT_ROLES,
  domains,
  organizationDomains,
  userPersonaPreferences,
  type UserPersonaPreferences,
} from "@shared/schema";
import {
  PERSONA_IDS,
  PERSONA_REGISTRY,
  SECURITY_ROLE_IDS,
  type PersonaId,
  type PersonaProfile,
  type SecurityRoleId,
} from "@shared/personaRegistry";
import { getDb } from "./db";
import { auditActor, recordSecurityAuditEvent } from "./auditEvents";
import { withUserTransaction } from "./tenantDb";

const MAX_JSON_BYTES = 65_536;
const PERSONA_ID_SCHEMA = z.enum(PERSONA_IDS);
const JSON_OBJECT_SCHEMA = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must contain JSON-compatible values" });
    } else if (Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.too_big, type: "string", maximum: MAX_JSON_BYTES, inclusive: true, message: "must be no larger than 65536 bytes" });
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must contain JSON-compatible values" });
  }
});

/** The only fields accepted by the self-service preference update API. */
export const personaPreferencePatchSchema = z.object({
  primaryPersona: PERSONA_ID_SCHEMA.optional(),
  secondaryPersonas: z.array(PERSONA_ID_SCHEMA).max(8).transform((ids) => [...new Set(ids)]).optional(),
  activeDomainSlug: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/).optional(),
  activeContext: JSON_OBJECT_SCHEMA.optional(),
  preferences: JSON_OBJECT_SCHEMA.optional(),
  complete: z.boolean().optional(),
  onboardingCompleted: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.complete !== undefined && value.onboardingCompleted !== undefined && value.complete !== value.onboardingCompleted) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["onboardingCompleted"], message: "complete and onboardingCompleted must agree when both are supplied" });
  }
});

export type PersonaPreferencePatch = z.infer<typeof personaPreferencePatchSchema>;
export type PersonaPreferenceUser = {
  id: number;
  email: string;
  role: SecurityRoleId;
  organizationId: number | null;
};

export interface PersonaPreferencesResponse {
  preferences: {
    primaryPersona: PersonaId;
    secondaryPersonas: PersonaId[];
    activeDomainSlug: string;
    activeContext: Record<string, unknown>;
    preferences: Record<string, unknown>;
    onboardingCompletedAt: Date | null;
  };
  selectedProfile: PersonaProfile;
  availableProfiles: PersonaProfile[];
  securityRole: SecurityRoleId;
  onboardingCompleted: boolean;
  /** True only when the user already has a persisted preference row. */
  hasPersistedPreferences: boolean;
}

export class PersonaPreferenceError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_persona" | "invalid_domain" | "invalid_user",
  ) {
    super(message);
    this.name = "PersonaPreferenceError";
  }
}

function isClientRole(role: SecurityRoleId): boolean {
  return (CLIENT_ROLES as readonly string[]).includes(role);
}

function isSecurityRole(value: unknown): value is SecurityRoleId {
  return typeof value === "string" && (SECURITY_ROLE_IDS as readonly string[]).includes(value);
}

function validatePreferenceUser(user: PersonaPreferenceUser): void {
  if (
    !Number.isSafeInteger(user.id)
    || user.id <= 0
    || typeof user.email !== "string"
    || user.email.trim().length === 0
    || !isSecurityRole(user.role)
    || (isClientRole(user.role) && user.organizationId === null)
    || (user.organizationId !== null && (!Number.isSafeInteger(user.organizationId) || user.organizationId <= 0))
  ) {
    throw new PersonaPreferenceError("The authenticated user is invalid.", "invalid_user");
  }
}

export function allowedPersonaProfiles(role: unknown): PersonaProfile[] {
  if (!isSecurityRole(role)) return [];
  return (Object.values(PERSONA_REGISTRY) as PersonaProfile[]).filter((profile) => profile.allowedSecurityRoles.includes(role));
}

function allowedProfiles(role: SecurityRoleId): PersonaProfile[] {
  return allowedPersonaProfiles(role);
}

export function normalizePersonaSelection(
  primaryPersona: unknown,
  secondaryPersonas: unknown,
  profiles: readonly PersonaProfile[],
): { primaryPersona: PersonaId; secondaryPersonas: PersonaId[] } {
  const fallbackProfile = profiles.find((profile) => profile.id === "general") ?? profiles[0];
  if (!fallbackProfile) throw new PersonaPreferenceError("No persona profile is available for this security role.", "invalid_user");

  const allowedIds = new Set(profiles.map((profile) => profile.id));
  const selectedProfile = typeof primaryPersona === "string" && allowedIds.has(primaryPersona as PersonaId)
    ? profiles.find((profile) => profile.id === primaryPersona)!
    : fallbackProfile;
  const normalizedSecondary = Array.isArray(secondaryPersonas)
    ? secondaryPersonas.filter((id): id is PersonaId => typeof id === "string" && id !== selectedProfile.id && allowedIds.has(id as PersonaId))
    : [];

  return {
    primaryPersona: selectedProfile.id,
    secondaryPersonas: Array.from(new Set(normalizedSecondary)),
  };
}

export function normalizeOnboardingCompletedAt(
  current: Date | null | undefined,
  completed: boolean | undefined,
  now = new Date(),
): Date | null {
  const currentValue = current instanceof Date && Number.isFinite(current.getTime()) ? current : null;
  if (completed === undefined) return currentValue;
  return completed ? currentValue ?? now : null;
}

function safeRecord(value: unknown): Record<string, unknown> {
  const parsed = JSON_OBJECT_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : {};
}

async function activeDomainsForUser(user: PersonaPreferenceUser): Promise<Array<{ slug: string; name: string; description: string | null; icon: string | null }>> {
  const db = getDb();
  if (isClientRole(user.role)) {
    if (user.organizationId === null) return [];
    return db.select({ slug: domains.slug, name: domains.name, description: domains.description, icon: domains.icon })
      .from(organizationDomains)
      .innerJoin(domains, eq(organizationDomains.domainId, domains.id))
      .where(and(eq(organizationDomains.organizationId, user.organizationId), eq(domains.active, true)));
  }
  return db.select({ slug: domains.slug, name: domains.name, description: domains.description, icon: domains.icon })
    .from(domains)
    .where(eq(domains.active, true));
}

function defaultDomainSlug(profile: PersonaProfile, activeDomains: readonly { slug: string }[]): string {
  return activeDomains.find((domain) => domain.slug === profile.defaultDomain)?.slug
    ?? activeDomains[0]?.slug
    ?? "";
}
export function resolveActiveDomainSlug(
  requestedSlug: unknown,
  profile: PersonaProfile,
  activeDomains: readonly { slug: string }[],
): string {
  return typeof requestedSlug === "string" && activeDomains.some((domain) => domain.slug === requestedSlug)
    ? requestedSlug
    : defaultDomainSlug(profile, activeDomains);
}

/** Distinguishes a database miss from the normalized general fallback. */
export function hasPersistedPersonaPreferences(row: UserPersonaPreferences | undefined): boolean {
  return row !== undefined;
}

function normalizePreferences(
  row: UserPersonaPreferences | undefined,
  user: PersonaPreferenceUser,
  profiles: PersonaProfile[],
  activeDomains: Array<{ slug: string }>,
): PersonaPreferencesResponse {
  const selection = normalizePersonaSelection(row?.primaryPersona, row?.secondaryPersonas, profiles);
  const selectedProfile = profiles.find((profile) => profile.id === selection.primaryPersona)!;
  const activeDomainSlug = resolveActiveDomainSlug(row?.activeDomainSlug, selectedProfile, activeDomains);
  const onboardingCompletedAt = normalizeOnboardingCompletedAt(row?.onboardingCompletedAt, undefined);

  return {
    preferences: {
      primaryPersona: selection.primaryPersona,
      secondaryPersonas: selection.secondaryPersonas,
      activeDomainSlug,
      activeContext: safeRecord(row?.activeContext),
      preferences: safeRecord(row?.preferences),
      onboardingCompletedAt,
    },
    selectedProfile,
    availableProfiles: profiles,
    securityRole: user.role,
    onboardingCompleted: onboardingCompletedAt !== null,
    hasPersistedPreferences: hasPersistedPersonaPreferences(row),
  };

}

async function loadUserRow(user: PersonaPreferenceUser): Promise<UserPersonaPreferences | undefined> {
  return withUserTransaction({ userId: user.id, organizationId: user.organizationId, role: user.role }, async (tx) => {
    const [row] = await tx.select().from(userPersonaPreferences)
      .where(eq(userPersonaPreferences.userId, user.id)).limit(1);
    return row;
  });
}

export async function getPersonaPreferences(user: PersonaPreferenceUser): Promise<PersonaPreferencesResponse> {
  validatePreferenceUser(user);
  const profiles = allowedProfiles(user.role);
  if (!profiles.length) throw new PersonaPreferenceError("No persona profile is available for this security role.", "invalid_user");
  const activeDomains = await activeDomainsForUser(user);
  const row = await loadUserRow(user);
  return normalizePreferences(row, user, profiles, activeDomains);
}

export async function upsertPersonaPreferences(
  user: PersonaPreferenceUser,
  patch: PersonaPreferencePatch,
): Promise<PersonaPreferencesResponse> {
  return writePersonaPreferences(user, patch);
}

/** Only the checked Master AI authority may change this reserved preference. */
export async function setMasterAiPreference(
  user: PersonaPreferenceUser,
  state: { state: "on" | "off"; mode: "manual" | "ai_assist" | "ai_build" | "ai_scenario"; updatedAt: string; authorization: { generation: string; revision: number; verificationAttemptId?: number } },
): Promise<PersonaPreferencesResponse> {
  return writePersonaPreferences(user, {}, state);
}

async function writePersonaPreferences(
  user: PersonaPreferenceUser,
  patch: PersonaPreferencePatch,
  masterAiState?: Parameters<typeof setMasterAiPreference>[1],
): Promise<PersonaPreferencesResponse> {
  validatePreferenceUser(user);
  const profiles = allowedProfiles(user.role);
  if (!profiles.length) throw new PersonaPreferenceError("No persona profile is available for this security role.", "invalid_user");
  const activeDomains = await activeDomainsForUser(user);
  const existing = await loadUserRow(user);
  const current = normalizePreferences(existing, user, profiles, activeDomains);
  const { waveCMasterAi: _untrustedMasterAi, ...publicPreferences } = patch.preferences ?? current.preferences.preferences;
  const preferences = {
    ...publicPreferences,
    ...(masterAiState ? { waveCMasterAi: masterAiState } : {}),
  };

  const primaryPersona = patch.primaryPersona ?? current.preferences.primaryPersona;
  const selectedProfile = profiles.find((profile) => profile.id === primaryPersona);
  if (!selectedProfile) {
    throw new PersonaPreferenceError("The selected persona is not available for this security role.", "invalid_persona");
  }
  const selection = normalizePersonaSelection(
    primaryPersona,
    patch.secondaryPersonas ?? current.preferences.secondaryPersonas,
    profiles,
  );

  const activeDomainSlug = patch.activeDomainSlug ?? current.preferences.activeDomainSlug;
  if (!activeDomains.some((domain) => domain.slug === activeDomainSlug)) {
    throw new PersonaPreferenceError("The selected domain is not active or is not available to this organization.", "invalid_domain");
  }

  const completed = patch.complete ?? patch.onboardingCompleted;
  const now = new Date();
  const onboardingCompletedAt = normalizeOnboardingCompletedAt(current.preferences.onboardingCompletedAt, completed, now);
  await withUserTransaction({ userId: user.id, organizationId: user.organizationId, role: user.role }, async (tx) => {
    await tx.insert(userPersonaPreferences).values({
      userId: user.id,
      // Never accept tenant scope from the request body: this value is copied
      // exclusively from the authenticated session user.
      organizationId: user.organizationId,
      primaryPersona: selection.primaryPersona,
      secondaryPersonas: selection.secondaryPersonas,
      activeDomainSlug,
      activeContext: patch.activeContext ?? current.preferences.activeContext,
      preferences,
      onboardingCompletedAt,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: userPersonaPreferences.userId,
      set: {
        organizationId: user.organizationId,
        primaryPersona: selection.primaryPersona,
        secondaryPersonas: selection.secondaryPersonas,
        activeDomainSlug,
        activeContext: patch.activeContext ?? current.preferences.activeContext,
        // Preserve the reserved field from the row at commit time, not a stale
        // read before a concurrent OFF/configuration change.
        preferences: masterAiState
          ? sql`case when ${userPersonaPreferences.preferences}->'waveCMasterAi'->'authorization'->>'generation' is distinct from ${masterAiState.authorization.generation}
              or coalesce((${userPersonaPreferences.preferences}->'waveCMasterAi'->'authorization'->>'revision')::bigint, -1) <= ${masterAiState.authorization.revision}
            then coalesce(${userPersonaPreferences.preferences}, '{}'::jsonb) || ${JSON.stringify({ waveCMasterAi: masterAiState })}::jsonb
            else ${userPersonaPreferences.preferences} end`
          : sql`${JSON.stringify(preferences)}::jsonb || jsonb_strip_nulls(jsonb_build_object('waveCMasterAi', ${userPersonaPreferences.preferences}->'waveCMasterAi'))`,
        onboardingCompletedAt,
        updatedAt: now,
      },
    });
  });

  await recordSecurityAuditEvent(user.id, "persona_preferences_updated", {
    ...auditActor(user),
    primaryPersona: selection.primaryPersona,
    secondaryPersonas: selection.secondaryPersonas,
    activeDomainSlug,
    onboardingCompleted: onboardingCompletedAt !== null,
  });
  return getPersonaPreferences(user);
}
