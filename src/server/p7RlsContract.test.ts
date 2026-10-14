import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const migration=fs.readFileSync(path.resolve(process.cwd(),"migrations/0070_lios_p7_project_intelligence.sql"),"utf8");
const journal=JSON.parse(fs.readFileSync(path.resolve(process.cwd(),"migrations/meta/_journal.json"),"utf8")) as {entries:Array<{idx:number;tag:string}>};

test("P7 Project Intelligence tables are owner and organization isolated by RLS", () => {
  for(const table of ["project_intelligence_documents","project_intelligence_document_versions","project_intelligence_snapshots"]) {
    assert.ok(migration.includes('ALTER TABLE "'+table+'" ENABLE ROW LEVEL SECURITY'));
    assert.ok(migration.includes('"owner_user_id" = li_os_current_user_id()'));
    assert.ok(migration.includes('"organization_id" IS NOT DISTINCT FROM li_os_current_organization_id()'));
  }
});

test("P7 migration extends the P4 Artifact kind constraint with thesis", () => {
  assert.ok(migration.includes("'thesis'"));
  assert.ok(migration.includes('project_artifacts_kind_ck'));
});


test("P7 Time Machine migration retains immutable content-addressed document versions", () => {
  assert.ok(migration.includes('CREATE TABLE "project_intelligence_document_versions"'));
  assert.ok(migration.includes('"document_id" text NOT NULL'));
  assert.ok(migration.includes('"project_id","source_type","source_ref","content_hash"'));
  assert.ok(migration.includes('project_intelligence_document_version_hash_ck'));
});


test("P7 migration is journaled immediately after P5 so runtime migrators execute it", () => {
  const p5=journal.entries.find((entry)=>entry.tag==="0069_lios_p5_universal_data_fabric");
  const p7=journal.entries.filter((entry)=>entry.tag==="0070_lios_p7_project_intelligence");
  assert.ok(p5);
  assert.equal(p7.length,1);
  assert.equal(p7[0].idx,p5.idx+1);
});
