import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const migration=fs.readFileSync(path.resolve(process.cwd(),"migrations/0071_lios_p9_automation_continuous_intelligence.sql"),"utf8");
const journal=JSON.parse(fs.readFileSync(path.resolve(process.cwd(),"migrations/meta/_journal.json"),"utf8")) as {entries:Array<{idx:number;tag:string}>};

test("P9 automation tables are owner and organization isolated by RLS", () => {
  for(const table of ["project_automation_workflows","project_automation_runs","project_automation_notifications"]) {
    assert.ok(migration.includes('ALTER TABLE "'+table+'" ENABLE ROW LEVEL SECURITY'));
    assert.ok(migration.includes('"owner_user_id" = li_os_current_user_id()'));
    assert.ok(migration.includes('"organization_id" IS NOT DISTINCT FROM li_os_current_organization_id()'));
  }
});

test("P9 migration has event idempotency and durable observer cursor", () => {
  assert.ok(migration.includes('project_automation_runs_dedupe_unique'));
  assert.ok(migration.includes('"workflow_id","dedupe_key"'));
  assert.ok(migration.includes('"event_cursor" jsonb'));
  assert.ok(migration.includes('"claim_expires_at" timestamptz'));
});

test("P9 migration is journaled immediately after P7", () => {
  const p7=journal.entries.find((entry)=>entry.tag==="0070_lios_p7_project_intelligence");
  const p9=journal.entries.filter((entry)=>entry.tag==="0071_lios_p9_automation_continuous_intelligence");
  assert.ok(p7);
  assert.equal(p9.length,1);
  assert.equal(p9[0].idx,p7.idx+1);
});
