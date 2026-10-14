import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedPersonaProfiles,
  hasPersistedPersonaPreferences,
  normalizeOnboardingCompletedAt,
  normalizePersonaSelection,
  personaPreferencePatchSchema,
  resolveActiveDomainSlug,
} from "./personaPreferenceService";
import { authenticatedUser, personaPreferenceErrorStatus } from "./personaPreferenceRoutes";
import { PERSONA_REGISTRY } from "@shared/personaRegistry";
test("persona preference patches are strict and deduplicate secondary personas", () => {
  const parsed = personaPreferencePatchSchema.safeParse({
    primaryPersona: "equity_research",
    secondaryPersonas: ["portfolio_risk", "portfolio_risk", "quant_analyst"],
    activeDomainSlug: "economics_policy",
    activeContext: { symbol: "AAPL" },
    preferences: { density: "compact" },
    complete: true,
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(parsed.data.secondaryPersonas, ["portfolio_risk", "quant_analyst"]);
  assert.equal(parsed.data.complete, true);
});

test("persona preference patches reject tenant scope and conflicting completion aliases", () => {
  const tenantScope = personaPreferencePatchSchema.safeParse({
    primaryPersona: "general",
    organizationId: 42,
  });
  assert.equal(tenantScope.success, false);

  const conflictingCompletion = personaPreferencePatchSchema.safeParse({
    complete: true,
    onboardingCompleted: false,
  });
  assert.equal(conflictingCompletion.success, false);
});

test("persona preference patches reject non-object preference payloads", () => {
  const parsed = personaPreferencePatchSchema.safeParse({
    activeContext: ["not", "an", "object"],
  });
  assert.equal(parsed.success, false);
});

test("available personas are filtered by the authenticated security role", () => {
  const clientProfiles = allowedPersonaProfiles("client_user");
  const internalProfiles = allowedPersonaProfiles("internal_analyst");

  assert.equal(clientProfiles.some((profile) => profile.id === "quant_analyst"), false);
  assert.equal(internalProfiles.some((profile) => profile.id === "quant_analyst"), true);
  assert.deepEqual(allowedPersonaProfiles("unsupported-role"), []);
});

test("persona selection fails closed and never retains primary as a secondary", () => {
  const profiles = allowedPersonaProfiles("client_user");
  const selection = normalizePersonaSelection(
    "equity_research",
    ["equity_research", "portfolio_risk", "unsupported", "portfolio_risk"],
    profiles,
  );

  assert.equal(selection.primaryPersona, "equity_research");
  assert.deepEqual(selection.secondaryPersonas, ["portfolio_risk"]);
});

test("active domain resolution falls back only to an active domain", () => {
  const profile = PERSONA_REGISTRY.macro_economics;

  assert.equal(resolveActiveDomainSlug("unassigned", profile, [{ slug: "finance" }]), "finance");
  assert.equal(resolveActiveDomainSlug("economics_policy", profile, [{ slug: "economics_policy" }]), "economics_policy");
  assert.equal(resolveActiveDomainSlug("finance", profile, []), "");
});
test("persisted-preference detection does not confuse a missing row with general fallback", () => {
  assert.equal(hasPersistedPersonaPreferences(undefined), false);
  assert.equal(hasPersistedPersonaPreferences({} as never), true);
});


test("completion aliases preserve timestamps, set them once, and clear them explicitly", () => {
  const existing = new Date("2026-01-01T00:00:00.000Z");
  const now = new Date("2026-02-01T00:00:00.000Z");

  assert.equal(normalizeOnboardingCompletedAt(existing, undefined), existing);
  assert.equal(normalizeOnboardingCompletedAt(existing, true), existing);
  assert.equal(normalizeOnboardingCompletedAt(existing, false), null);
  assert.equal(normalizeOnboardingCompletedAt(null, true, now), now);
});

test("route identity is sourced from the authenticated user and maps service errors safely", () => {
  const req = {
    user: {
      id: 42,
      email: "analyst@example.test",
      role: "client_user",
      organizationId: 17,
    },
  } as never;

  assert.deepEqual(authenticatedUser(req), {
    id: 42,
    email: "analyst@example.test",
    role: "client_user",
    organizationId: 17,
  });
  assert.equal(personaPreferenceErrorStatus("invalid_user"), 403);
  assert.equal(personaPreferenceErrorStatus("invalid_persona"), 422);
  assert.equal(personaPreferenceErrorStatus("invalid_domain"), 422);
});

test("route identity extraction rejects requests without an authenticated user", () => {
  assert.throws(
    () => authenticatedUser({} as never),
    (error: unknown) => error instanceof Error && error.message === "Authentication is required.",
  );
});
