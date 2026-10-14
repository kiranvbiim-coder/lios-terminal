import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

describe("child tenant RLS contract", () => {
  const sql = fs.readFileSync(path.resolve(process.cwd(), "migrations/0042_rls_tenant_isolation.sql"), "utf8");
  for (const table of ["workstreams", "deliverables", "meetings", "workstream_comments", "engagement_agreements", "engagement_payments"]) {
    it(`enables RLS for ${table}`, () => assert.ok(sql.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)));
    it(`has tenant policy for ${table}`, () => {
      assert.equal((sql.match(new RegExp(`CREATE POLICY li_os_${table}_tenant\\b`, "g")) ?? []).length, 1);
    });
  }
  it("uses parent ownership rather than request-supplied tenant ids", () => {
    assert.ok(sql.includes("FROM engagements e"));
    assert.ok(sql.includes("JOIN engagements e ON e.id = w.engagement_id"));
    assert.ok(sql.includes("li_os_current_organization_id()"));
  });
});
