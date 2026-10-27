import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SourceConnection } from "@shared/schema";
import type { InstalledPluginSnapshot } from "./p13PluginManager";
import { chatExtensionCatalog } from "./chatExtensionCatalog";
import { chatExtensionCatalogSchema } from "@shared/chatExtensionCatalog";

const plugin = {
  id: "company.research",
  version: "1.4.0",
  manifest: {
    name: "Company Research",
    skills: [{ componentId: "company.research.skill" }],
    artifacts: [{ componentId: "company.research.artifact" }],
    permissions: ["unsafe.permission.hidden"],
    signer: { keyId: "secret-publisher-key", signatureBase64: "sensitive" },
  },
  trust: { state: "trusted", packageDigest: "secret-digest" },
  componentIds: ["company.research.skill"],
} as unknown as InstalledPluginSnapshot;

function connection(id: number, userId: number, org: number | null, sourceType: string, status: string): SourceConnection {
  return {
    id,
    userId,
    organizationId: org,
    sourceType,
    status,
    name: `MCP ${id}`,
    config: { endpoint: "https://secret.example.test/mcp", token: "DO_NOT_SEND", projectId: 77 },
    credentialRef: "vault:sensitive",
  } as unknown as SourceConnection;
}

test("P3 Chat extension catalog exposes only non-executable plugin metadata and owner MCP", () => {
  const catalog = chatExtensionCatalog({
    plugins: [plugin],
    connections: [
      connection(1, 7, null, "mcp", "healthy"),
      connection(2, 8, null, "mcp", "healthy"),
      connection(3, 7, 34, "mcp", "healthy"),
      connection(4, 7, null, "file", "healthy"),
      connection(5, 7, null, "mcp", "configured"),
    ],
    userId: 7, organizationId: null, managementAvailable: true,
    isPluginLiveTrusted: () => true,
  });
  assert.equal(chatExtensionCatalogSchema.safeParse(catalog).success, true);
  assert.deepEqual(catalog.mcpConnections.map(row => row.id), [1, 5]);
  assert.equal(catalog.plugins[0].trusted, true);
  assert.equal(catalog.plugins[0].registered, true);
  assert.equal(catalog.plugins[0].executableFromChat, false);
  assert.equal(catalog.plugins[0].skillCount, 1);
  assert.equal(catalog.mcpConnections[0].explicitApprovalRequired, true);
  assert.equal(catalog.mcpConnections[0].projectRequired, true);
  assert.equal(catalog.mcpConnections[0].projectId, 77);
  assert.equal(catalog.mcpConnections[1].status, "configured");
  assert.equal(catalog.installationManagedByHomeOwner, true);
  assert.equal(catalog.managementAvailable, true);
  assert.equal(catalog.managementAvailable, true);
  const json = JSON.stringify(catalog);
  for (const forbidden of ["secret.example", "DO_NOT_SEND", "vault:sensitive", "signatureBase64", "secret-publisher-key", "unsafe.permission.hidden", "secret-digest"]) {
    assert.equal(json.includes(forbidden), false, `${forbidden} must not be exposed to Chat`);
  }
});

test("P3 Chat catalog masks unsupported/untrusted plugin execution and clamps result size", () => {
  const revoked = { ...plugin, trust: { state: "revoked" }, componentIds: ["old"] } as unknown as InstalledPluginSnapshot;
  const catalog = chatExtensionCatalog({
    plugins: Array.from({ length: 120 }, () => revoked),
    connections: Array.from({ length: 120 }, (_, id) => connection(id + 1, 5, null, "mcp", "invalid")),
    userId: 5, organizationId: null,
    isPluginLiveTrusted: () => true,
  });
  assert.equal(catalog.plugins.length, 100);
  assert.equal(catalog.mcpConnections.length, 100);
  assert.ok(catalog.plugins.every(row => !row.trusted && !row.registered && !row.executableFromChat));
});

test("P3 stale install snapshot cannot claim trust after live publisher revocation", () => {
  const catalog = chatExtensionCatalog({
    plugins: [plugin], connections: [],
    userId: 7, organizationId: null,
    isPluginLiveTrusted: () => false,
  });
  assert.equal(catalog.plugins[0].trusted, false);
  assert.equal(catalog.plugins[0].registered, false);
  assert.equal(catalog.plugins[0].executableFromChat, false);
});

test("P3 Chat hides credential-like labels and does not allow non-owner management", () => {
  const leaking = {
    ...plugin,
    manifest: { ...plugin.manifest, name: "https://user:password@private.example/path?token=bad" },
  } as unknown as InstalledPluginSnapshot;
  const catalog = chatExtensionCatalog({
    plugins: [leaking],
    connections: [{
      ...connection(1, 5, null, "mcp", "healthy"),
      name: "api_key=private-secret",
    }],
    userId: 5,
    organizationId: null,
    isPluginLiveTrusted: () => true,
  });
  assert.equal(catalog.managementAvailable, false);
  assert.equal(catalog.plugins[0].name, "Installed plugin");
  assert.equal(catalog.mcpConnections[0].name, "MCP connection 1");
  assert.equal(JSON.stringify(catalog).includes("private-secret"), false);
});

test("P3 catalog route stays authenticated, read only, and P13 installation remains owner-managed", () => {
  const routes = readFileSync(new URL("./p13ExtensionRoutes.ts", import.meta.url), "utf8");
  assert.match(routes, /router\.use\(requireAuth\)/);
  assert.match(routes, /router\.get\("\/chat-catalog"/);
  assert.match(routes, /chatExtensionCatalog\(/);
  assert.match(routes, /getP13PluginRuntimeHost\(\)\.plugins\.list\(\)/);
  assert.match(routes, /const actor = await currentOwner\(req\)/);
  assert.match(routes, /router\.post\("\/install"/);
  assert.doesNotMatch(routes, /router\.post\("\/chat-catalog"/);
});
