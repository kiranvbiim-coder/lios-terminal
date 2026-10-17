import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { RuntimeRegistry } from "@shared/runtimeRegistry";
import { liosPluginManifestV1Schema } from "@shared/pluginSdk";
import { P13PluginRuntimeHost } from "./p13PluginRuntime";
import { computePluginPackageDigest, signPluginManifest } from "./p13PluginTrust";
import { P13ExtensionService, type ExtensionPrincipal } from "./p13ExtensionService";

const owner: ExtensionPrincipal = { userId: 1, role: "internal_admin", organizationId: null, active: true, mustChangePassword: false, lockedUntil: null, homeOwner: true };
function fixture() {
  const host = new P13PluginRuntimeHost({ registry: new RuntimeRegistry() });
  let now = Date.now();
  const service = new P13ExtensionService(host, null, () => now);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const bytes = Buffer.from("Explicit declarative finance fixture; no executable payload");
  const digest = computePluginPackageDigest(bytes);
  const manifest = signPluginManifest(liosPluginManifestV1Schema.parse({ apiVersion: "1", id: "com.example.owner-finance", name: "Owner finance fixture", version: "1.0.0", publisher: "Explicit verification publisher", lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null }, runtime: { kind: "declarative", entrypoint: null }, dependencies: [], permissions: [], connectors: [], tools: [], artifacts: [{ id: "chart", componentId: "com.example.owner-finance.chart", name: "Owner chart support", capabilities: ["finance.chart"], artifactKinds: ["chart"] }], agents: [], skills: [], integrity: null, signer: null }), "owner.fixture.key", privateKey, digest);
  const input = { kind: "p13" as const, manifest, payloadBase64: bytes.toString("base64") };
  const key = { publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(), fingerprint: crypto.createHash("sha256").update(publicKey.export({ format: "der", type: "spki" })).digest("hex") };
  const review = () => { const untrusted = service.preview(owner, input); assert.equal(untrusted.installable, false); return service.trustPublisher(owner, { previewId: untrusted.previewId, reviewHash: untrusted.reviewHash, ...key, trustPublisher: true }); };
  return { host, service, input, key, digest, review, expire: () => { now += 11 * 60_000; } };
}
test("exact publisher/package review and rights consent activate canonical declarative contributions then revoke them", () => {
  const f = fixture();
  const preview = f.review();
  assert.equal(preview.trust, "trusted");
  assert.equal(preview.installable, true);
  const consent = { previewId: preview.previewId, reviewHash: preview.reviewHash, packageDigest: preview.packageDigest, consent: true, rightsConfirmed: true };
  assert.throws(() => f.service.install(owner, { ...consent, rightsConfirmed: false }));
  assert.throws(() => f.service.install(owner, { ...consent, packageDigest: "0".repeat(64) }), /bytes/);
  const installed = f.service.install(owner, consent);
  assert.equal(installed.kind, "p13");
  assert.equal(f.host.registry.require("com.example.owner-finance.chart").descriptor.kind, "artifact_renderer");
  assert.equal(f.service.inspect(owner, "p13", "com.example.owner-finance").kind, "p13");
  assert.throws(() => f.service.install(owner, consent), /review not found/);
  assert.throws(() => f.service.revoke(owner, "p13", "com.example.owner-finance", "0".repeat(64)), /changed/);
  f.service.revoke(owner, "p13", "com.example.owner-finance", f.digest);
  assert.equal(f.host.registry.get("com.example.owner-finance.chart"), null);
  const revoked = f.service.preview(owner, f.input);
  assert.equal(revoked.installable, false);
  assert.equal(revoked.trust, "revoked");
});
test("current Home ownership, exact key identity, expiry and immutable package bytes fence extension mutation", () => {
  const f = fixture();
  for (const changed of [{ ...owner, role: "client_admin" }, { ...owner, homeOwner: false }, { ...owner, organizationId: 2 }, { ...owner, active: false }]) assert.throws(() => f.service.preview(changed, f.input), /current unlocked Home owner/);
  const untrusted = f.service.preview(owner, f.input);
  assert.throws(() => f.service.trustPublisher(owner, { previewId: untrusted.previewId, reviewHash: untrusted.reviewHash, ...f.key, fingerprint: "0".repeat(64), trustPublisher: true }), /fingerprint/);
  assert.throws(() => f.service.preview(owner, { ...f.input, payloadBase64: "not base64" }), /base64/);
  const trusted = f.review();
  f.expire();
  assert.throws(() => f.service.install(owner, { previewId: trusted.previewId, reviewHash: trusted.reviewHash, packageDigest: trusted.packageDigest, consent: true, rightsConfirmed: true }), /expired/);
  assert.equal(f.host.registry.get("com.example.owner-finance.chart"), null);
});
