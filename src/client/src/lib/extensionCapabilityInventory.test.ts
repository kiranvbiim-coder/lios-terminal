import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ExtensionCatalog, ExtensionPreview } from "@shared/p13ExtensionContracts";
import { extensionPreviewAvailability, summarizeExtensionCapabilities } from "./extensionCapabilityInventory";

const digest = "a".repeat(64);
function catalog(overrides: Partial<ExtensionCatalog> = {}): ExtensionCatalog {
  return {
    managementAllowed: true, sessionOnly: true, packImportAvailable: true,
    plugins: [{
      id: "finance.widgets", version: "1.0.0",
      componentIds: ["liosskill.report", "lios.artifact.chart"],
      trust: { state: "trusted", reason: "Signed & registered", packageDigest: digest, manifestDigest: digest, keyId: "publisher.v1" },
      manifest: {
        id: "finance.widgets", name: "Finance Widgets", publisher: "Independent publisher",
        permissions: ["project.read", "artifact.read"],
        runtime: { kind: "declarative", entrypoint: null },
        skills: [{ componentId: "liosskill.report", name: "Report research", toolIds: ["read.citations"] }],
        artifacts: [{ componentId: "lios.artifact.chart", name: "Chart rendering", artifactKinds: ["chart"] }],
        connectors: [{ componentId: "connector.unapproved", name: "External Broker" }],
        tools: [{ componentId: "tool.unapproved", name: "External execution" }],
        agents: [{ componentId: "agent.unapproved", name: "Autonomous Agent" }],
      },
    }],
    packs: [{
      packId: "quant.bundle", activeVersion: null,
      versions: [{ version: "1.0.0", state: "installed", lastHealth: "ready" }],
    }],
    ...overrides,
  } as unknown as ExtensionCatalog;
}

test("P13 canonical catalog reports registered skill/Artifact contributions but never infers health, rights or authority", () => {
  const summary = summarizeExtensionCapabilities(catalog());
  assert.equal(summary.registered, 2);
  assert.equal(summary.blocked, 0);
  assert.equal(summary.unsupported, 3);
  assert.equal(summary.inactive, 1);
  assert.equal(summary.entries.length, 6);
  for (const row of summary.entries.filter(row => row.availability === "registered_session")) {
    assert.match(row.availabilityLabel, /Registered this session/);
    assert.match(row.health, /not independently verified/);
    assert.deepEqual(row.permissions, ["project.read", "artifact.read"]);
    assert.match(row.reason, /live policy, input, source and rights checks/);
  }
  const pack = summary.entries.find(row => row.kind === "pack")!;
  assert.equal(pack.availability, "stored_inactive");
  assert.match(pack.reason, /not a supervised executable activation grant/);
  assert.match(pack.health, /ready/);
  assert.ok(!summary.entries.some(row => /Execution approved|Externally verified/.test(row.availabilityLabel)));
});

test("untrusted, revoked or unregistered contributions are blocked regardless of their manifest claims", () => {
  const normal = catalog();
  const plugin = normal.plugins[0]!;
  for (const state of ["revoked", "unknown", "unverified"]) {
    const altered = catalog({ plugins: [{ ...plugin, trust: { ...plugin.trust, state } }] });
    const summary = summarizeExtensionCapabilities(altered);
    assert.equal(summary.registered, 0);
    assert.equal(summary.blocked, 2);
  }
  const missingComponent = catalog({ plugins: [{ ...plugin, componentIds: ["liosskill.report"] }] });
  const summary = summarizeExtensionCapabilities(missingComponent);
  assert.equal(summary.registered, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.entries.find(row => row.id === "lios.artifact.chart")!.availability, "blocked");
  const digestAbsent = catalog({ plugins: [{ ...plugin, trust: { ...plugin.trust, packageDigest: null } }] });
  assert.equal(summarizeExtensionCapabilities(digestAbsent).registered, 0);
});

test("executable connector/tool/agent claims are not made available by declarative plugin metadata", () => {
  const rows = summarizeExtensionCapabilities(catalog()).entries;
  for (const kind of ["connector", "tool", "agent"] as const) {
    const row = rows.find(item => item.kind === kind)!;
    assert.equal(row.availability, "unsupported");
    assert.match(row.reason, /cannot be activated by this declarative installer/);
  }
});

test("empty and disabled local catalogs do not fabricate available packages or health", () => {
  const empty = catalog({ plugins: [], packs: [], packImportAvailable: false });
  const summary = summarizeExtensionCapabilities(empty);
  assert.deepEqual(summary.entries, []);
  assert.equal(summary.registered, 0);
  assert.match(summary.importPosture, /P11 import is unavailable/);
  const denied = summarizeExtensionCapabilities(catalog({ managementAllowed: false }));
  assert.match(denied.importPosture, /not permitted/);
  const noHealth = catalog();
  noHealth.packs[0]!.versions[0]!.lastHealth = "";
  assert.match(summarizeExtensionCapabilities(noHealth).entries.find(x => x.kind === "pack")!.health, /not reported/);
});

test("existing P13 owner routes and rights review stay canonical and the UX exposes state rather than offering execution", () => {
  const panel = readFileSync(new URL("../components/GovernedExtensionsPanel.tsx", import.meta.url), "utf8");
  const server = readFileSync(new URL("../../../server/p13ExtensionService.ts", import.meta.url), "utf8");
  assert.match(panel, /summarizeExtensionCapabilities\(catalog\)/);
  assert.match(panel, /data-testid="extension-capability-inventory"/);
  assert.match(panel, /data-capability-state=\{item.availability\}/);
  assert.match(panel, /Manifest permission requests/);
  assert.match(panel, /Current Home runtime|current Home runtime/i);
  assert.match(panel, /data-testid="extensions-refresh-catalog"/);
  assert.match(panel, /setCatalog\(null\); setInspection\(null\); setRevokeTarget\(null\)/);
  assert.match(panel, /extensionRequest\("\/install"/);
  assert.match(panel, /rightsConfirmed: true/);
  assert.match(panel, /Confirm exact revocation/);
  assert.match(server, /this.admit\(actor\)/);
  assert.match(server, /this.host.plugins.list\(\)/);
  assert.match(server, /this.packs\?\.discover\(\)/);
  assert.match(server, /rightsConfirmed/);
  assert.doesNotMatch(panel, /\/api\/permissions\/grant|\/api\/plugins\/install-unsafe/);
});

test("local previews are reviewable but not installed and respect blocked or inactive server posture", () => {
  const preview = (activation: ExtensionPreview["activation"], installable: boolean) =>
    ({ activation, installable } as ExtensionPreview);
  const signed = extensionPreviewAvailability(preview("declarative", true));
  assert.equal(signed.state, "reviewable_session");
  assert.match(signed.label, /not installed/);
  assert.match(signed.explanation, /no tool or external action permission/);
  const inactive = extensionPreviewAvailability(preview("inactive_only", true));
  assert.equal(inactive.state, "reviewable_inactive");
  assert.match(inactive.explanation, /does not enable execution/);
  for (const state of ["declarative", "inactive_only", "unavailable"] as const) {
    const rejected = extensionPreviewAvailability(preview(state, false));
    assert.equal(rejected.state, "blocked");
    assert.match(rejected.explanation, /no installation or execution was attempted/);
  }
  const declaredUnusable = extensionPreviewAvailability(preview("unavailable", true));
  assert.equal(declaredUnusable.state, "blocked");
});

test("local package preview status is descriptive and canonical P13 still enforces consent, digest and rights", () => {
  const panel = readFileSync(new URL("../components/GovernedExtensionsPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /data-testid="extension-preview-availability"/);
  assert.match(panel, /data-preview-state=\{extensionPreviewAvailability\(preview\)\.state\}/);
  assert.match(panel, /disabled=\{busy \|\| !preview\.installable \|\| !rights \|\| !consent\}/);
  assert.match(panel, /packageDigest: preview\.packageDigest, consent: true, rightsConfirmed: true/);
});
