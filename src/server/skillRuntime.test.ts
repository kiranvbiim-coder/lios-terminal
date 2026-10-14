import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeRegistry } from "@shared/runtimeRegistry";
import {
  FIRST_PARTY_SKILL_PLUGIN_ID,
  firstPartySkillPluginManifest,
} from "@shared/skillPluginBridge";
import { createP13PluginRuntimeHost, replaceP13PluginRuntimeHostForTest } from "./p13PluginRuntime";
import { PluginTrustStore } from "./p13PluginTrust";
import {
  ensureFirstPartySkillsInstalled,
  listInstalledSkillAdapters,
  listInstalledSkillCatalog,
} from "./skillRuntime";

function isolatedHost() {
  return createP13PluginRuntimeHost({
    registry: new RuntimeRegistry(),
    trustStore: new PluginTrustStore(),
    liosVersion: "1.0.0",
  });
}

test("L11 first-party skills bootstrap through the normal trusted P13 path", () => {
  const host = isolatedHost();
  replaceP13PluginRuntimeHostForTest(host);
  try {
    ensureFirstPartySkillsInstalled();
    const snapshot = host.plugins.get(FIRST_PARTY_SKILL_PLUGIN_ID);
    assert.ok(snapshot);
    assert.equal(snapshot!.trust.state, "trusted");
    assert.equal(snapshot!.manifest.runtime.kind, "declarative");
    assert.equal(snapshot!.manifest.skills.length, 3);

    const adapters = listInstalledSkillAdapters();
    assert.equal(adapters.length, 3);
    assert.ok(adapters.every((adapter) => adapter.descriptor.kind === "skill"));
    assert.ok(adapters.every((adapter) => adapter.definition.toolIds.length > 0));
    assert.ok(adapters.some((adapter) => adapter.definition.toolIds.includes("agent.browser.navigate")));

    const catalog = listInstalledSkillCatalog();
    assert.equal(catalog.length, 3);
    assert.ok(catalog.every((skill) => skill.firstParty && skill.approval === "approved"));

    ensureFirstPartySkillsInstalled();
    assert.equal(host.plugins.list().filter((plugin) => plugin.id === FIRST_PARTY_SKILL_PLUGIN_ID).length, 1);
  } finally {
    replaceP13PluginRuntimeHostForTest(null);
  }
});

test("L11 unsigned request-shaped skill packages cannot bypass P13 trust", () => {
  const host = isolatedHost();
  assert.throws(
    () => host.installDeclarativePlugin({ manifest: firstPartySkillPluginManifest() }),
    /Skills require a trusted publisher/,
  );
  assert.equal(host.plugins.list().length, 0);
  assert.equal(host.registry.list("skill").length, 0);
});
