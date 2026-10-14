import test from "node:test";
import assert from "node:assert/strict";
import { PERSONA_IDS, PERSONA_REGISTRY } from "@shared/personaRegistry";
import {
  DEFAULT_TERMINAL_PERSONA_ID,
  getTerminalPersona,
  resolveTerminalPersonaId,
  TERMINAL_PERSONA_ALIASES,
} from "./terminalPersona";

test("every canonical persona has complete workflow metadata", () => {
  for (const id of PERSONA_IDS) {
    const profile = PERSONA_REGISTRY[id];
    assert.equal(profile.id, id);
    assert.ok(profile.label);
    assert.ok(profile.description);
    assert.ok(profile.allowedSecurityRoles.length > 0);
    assert.ok(profile.preferredViews.length > 0);
    assert.ok(profile.capabilities.length > 0);
    assert.ok(profile.starterLabels.length > 0);
  }
});

test("legacy terminal persona IDs resolve to canonical IDs", () => {
  for (const [legacyId, canonicalId] of Object.entries(TERMINAL_PERSONA_ALIASES)) {
    assert.equal(resolveTerminalPersonaId(legacyId), canonicalId);
    const profile = getTerminalPersona(legacyId);
    assert.equal(profile.id, legacyId);
    assert.equal(profile.canonicalId, canonicalId);
    assert.equal(profile.aliasOf, canonicalId);
  }
});

test("unknown persona IDs fail closed to the general profile", () => {
  assert.equal(resolveTerminalPersonaId("not-a-persona"), DEFAULT_TERMINAL_PERSONA_ID);
  assert.equal(getTerminalPersona("not-a-persona").canonicalId, DEFAULT_TERMINAL_PERSONA_ID);
});
