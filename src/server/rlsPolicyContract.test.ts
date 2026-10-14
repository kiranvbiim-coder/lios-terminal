import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

describe("tenant RLS migration contract", () => {
  const migration = fs.readFileSync(path.resolve(process.cwd(), "migrations/0042_rls_tenant_isolation.sql"), "utf8");
  const journal = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "migrations/meta/_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "migrations/meta/0042_snapshot.json"), "utf8")) as {
    id: string;
    prevId: string;
    version: string;
    dialect: string;
    policies: Record<string, unknown>;
  };
  const previousSnapshot = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "migrations/meta/0041_snapshot.json"), "utf8")) as {
    id: string;
  };

  for (const table of ["portfolios", "client_datasets", "decision_records", "credit_wallets", "client_audit_events", "engagements"]) {
    it(`protects ${table} with organization context`, () => {
      assert.ok(migration.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
      assert.equal((migration.match(new RegExp(`CREATE POLICY li_os_${table}_tenant\\b`, "g")) ?? []).length, 1);
      assert.ok(migration.includes("organization_id = li_os_current_organization_id()"));
    });
  }

  it("protects private persona preferences by authenticated user", () => {
    assert.ok(migration.includes("ALTER TABLE user_persona_preferences ENABLE ROW LEVEL SECURITY"));
    assert.equal((migration.match(/CREATE POLICY li_os_user_persona_preferences_owner\b/g) ?? []).length, 1);
    assert.ok(migration.includes("user_id = li_os_current_user_id()"));
  });

  it("uses both USING and WITH CHECK", () => {
    assert.ok(migration.includes("USING (organization_id = li_os_current_organization_id())"));
    assert.ok(migration.includes("WITH CHECK (organization_id = li_os_current_organization_id())"));
  });

  it("is the single journaled migration after 0041", () => {
    const previous = journal.entries.find((entry) => entry.tag === "0041_user_persona_preferences");
    const current = journal.entries.filter((entry) => entry.tag === "0042_rls_tenant_isolation");
    assert.ok(previous);
    assert.equal(current.length, 1);
    assert.equal(current[0].idx, previous.idx + 1);
  });

  it("keeps custom SQL policies out of the generated schema snapshot", () => {
    assert.equal(snapshot.version, "7");
    assert.equal(snapshot.dialect, "postgresql");
    assert.equal(snapshot.prevId, previousSnapshot.id);
    assert.deepEqual(snapshot.policies, {});
  });
});
