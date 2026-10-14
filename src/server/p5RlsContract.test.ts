import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const sql = fs.readFileSync(path.resolve(process.cwd(), "migrations/0069_lios_p5_universal_data_fabric.sql"), "utf8");

test("P5 tenant-owned Data Fabric tables enable RLS", () => {
  for (const table of ["data_coverage_ledger","semantic_metric_definitions","data_lineage_receipts","external_rights_assessments","data_field_mappings"]) {
    assert.ok(sql.includes(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`), table);
  }
  assert.ok(sql.includes('"owner_user_id" = li_os_current_user_id()'));
  assert.ok(sql.includes('"organization_id" IS NOT DISTINCT FROM li_os_current_organization_id()'));
});

test("P5 mapping persistence is migration-owned and versioned", () => {
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS "data_field_mappings"'));
  assert.ok(sql.includes("data_field_mappings_target_kind_ck"));
  assert.ok(sql.includes("data_field_mappings_version_ck"));
});
