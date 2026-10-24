import assert from "node:assert/strict";
import test from "node:test";
import type { SourceConnection } from "@shared/schema";
import { assertP9CurrentMcpSourceReferences } from "./p9LiveMcpSourcePolicy";

const ctx = { userId: 7, organizationId: null, role: "internal_analyst" as const };
const source = {
  id: 41, userId: 7, organizationId: null, sourceType: "mcp",
  status: "configured", credentialRef: "vault:owner-41",
  config: { projectId: 77, aiTransmission: "allow", aiUsageRights: "cleared" },
} as SourceConnection;
const refs = ["mcp-server:source:41", "mcp-tool:quotes.read", "source-connection:41"];
const eligible = () => assertP9CurrentMcpSourceReferences(ctx, 77, refs, [source], () => true);

test("P9 rechecks current MCP rights for exact canonical saved source references", () => {
  assert.doesNotThrow(eligible);
  assert.doesNotThrow(() => assertP9CurrentMcpSourceReferences(ctx, 77, ["filing:SEC-01"], [], () => false),
    "ordinary P9 evidence without a connected source keeps working");
  assert.doesNotThrow(() => assertP9CurrentMcpSourceReferences(ctx, 77, ["source-connection:41"], [source], () => true));
  assert.throws(() => assertP9CurrentMcpSourceReferences(ctx, 77, ["mcp-tool:quotes.read"], [source], () => true),
    /no owned source identity/);
});

test("P9 MCP source admission fails closed when owner, Project, rights, status or credential changes", () => {
  const changes: Array<[Partial<SourceConnection>, RegExp]> = [
    [{ userId: 8 }, /owner authority/],
    [{ organizationId: 99 }, /owner authority/],
    [{ status: "invalid" }, /owner authority/],
    [{ sourceType: "file" }, /owner authority/],
    [{ config: { ...source.config, projectId: 88 } }, /Project/],
    [{ config: { ...source.config, aiTransmission: "deny" } }, /release rights/],
    [{ config: { ...source.config, aiUsageRights: "unknown" } }, /release rights/],
  ];
  for (const [change, expected] of changes) {
    assert.throws(() => assertP9CurrentMcpSourceReferences(
      ctx, 77, refs, [{ ...source, ...change }], () => true,
    ), expected);
  }
  assert.throws(() => assertP9CurrentMcpSourceReferences(ctx, 77, refs, [source], () => false),
    /credential is revoked/);
  assert.throws(() => assertP9CurrentMcpSourceReferences(ctx, 77, refs, [], () => true),
    /no longer available/,
    "a deleted saved source cannot be silently treated as an unrelated source");
});

test("P9 MCP source references cannot be forged or orphaned", () => {
  for (const ref of ["mcp-server:source:0", "mcp-server:source:41/delete", "mcp-server:fake:41", "source-connection:-7", "source-connection:01"]) {
    assert.throws(() => assertP9CurrentMcpSourceReferences(ctx, 77, [ref], [source], () => true),
      /identity/);
  }
  assert.throws(() => assertP9CurrentMcpSourceReferences(ctx, 77, ["source-connection:500"], [source], () => true),
    /no longer available/);
});
