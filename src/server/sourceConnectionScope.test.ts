import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assertSourceConnectionScope } from "./sourceConnectionScope";

test("P5 BYOD adapters accept only exact user and organization matches", () => {
  const owner = { userId: 17, organizationId: 3 };
  assert.doesNotThrow(() => assertSourceConnectionScope(owner, { userId: 17, organizationId: 3 }));
  assert.throws(() => assertSourceConnectionScope(owner, { userId: 18, organizationId: 3 }), /not available/);
  assert.throws(() => assertSourceConnectionScope(owner, { userId: 17, organizationId: 4 }), /not available/);
  assert.throws(() => assertSourceConnectionScope(owner, { userId: 17, organizationId: null }), /not available/);
  assert.doesNotThrow(() => assertSourceConnectionScope(
    { userId: 17, organizationId: null }, { userId: 17, organizationId: null },
  ));
});

test("P5 file, cloud and MCP adapters check tenant scope before touching private sources", () => {
  const file = readFileSync(new URL("./fileSourceProvider.ts", import.meta.url), "utf8");
  const other = readFileSync(new URL("./sourceConnectionProviderAdapter.ts", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("./providerRuntimeRegistry.ts", import.meta.url), "utf8");
  const fileFetch = file.match(/async fetch\(request, context\) \{([\s\S]*?)\n    \},/);
  const fileHealth = file.match(/async health\(context\) \{([\s\S]*?)\n    \},/);
  assert.ok(fileFetch && fileHealth);
  assert.match(fileFetch[1], /^\s*assertSourceConnectionScope\(connection, context\);/);
  assert.match(fileHealth[1], /^\s*assertSourceConnectionScope\(connection, context\);/);
  assert.equal((other.match(/assertSourceConnectionScope\(connection, context\)/g) ?? []).length, 4);
  assert.match(runtime, /ctx\.userId !== actor\.id/);
  assert.match(runtime, /connection\.organizationId === ctx\.organizationId/);
});

test("P5 source receipts do not expose signed cloud endpoints or full MCP resource URIs", () => {
  const adapter = readFileSync(new URL("./sourceConnectionProviderAdapter.ts", import.meta.url), "utf8");
  assert.match(adapter, /cloud-object:\$\{hashLedgerValue\(result\.endpoint\)\}/);
  assert.match(adapter, /mcp-resource:\$\{hashLedgerValue\(resourceUri\)\}/);
  assert.doesNotMatch(adapter, /sourceRefs: \[\x60source-connection:\$\{connection\.id\}\x60, result\.endpoint\]/);
  assert.doesNotMatch(adapter, /sourceRefs: \[resourceUri,/);
});
