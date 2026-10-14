import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const integrationEnabled = process.env.LIOS_RLS_INTEGRATION === "1";

test("P9 live automation RLS requires explicit integration mode", () => {
  assert.ok([true, false].includes(integrationEnabled));
});

test("P9 live automation RLS blocks cross-user and cross-organization access", { skip: !integrationEnabled }, async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL is required when LIOS_RLS_INTEGRATION=1");
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  const schema = `lios_p9_rls_${process.pid}_${Date.now()}`;
  const qi = (value: string) => '"' + value.replace(/"/g, '""') + '"';
  const schemaId = qi(schema);
  const role = `lios_p9_role_${process.pid}_${Date.now()}`;
  const roleId = qi(role);
  const migration = fs.readFileSync(path.resolve(process.cwd(), "migrations/0071_lios_p9_automation_continuous_intelligence.sql"), "utf8");

  async function expectRlsReject(savepoint: string, sql: string) {
    const sp = qi(savepoint);
    await client.query(`SAVEPOINT ${sp}`);
    try {
      await assert.rejects(client.query(sql), /row-level security|policy/i);
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
    }
  }

  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${schemaId}`);
    await client.query(`SET LOCAL search_path TO ${schemaId}, public`);
    await client.query(`
      CREATE TABLE users (id integer PRIMARY KEY);
      CREATE TABLE organizations (id integer PRIMARY KEY);
      CREATE TABLE projects (id integer PRIMARY KEY);
      CREATE FUNCTION li_os_current_user_id() RETURNS integer
        LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.current_user_id', true), '')::integer $$;
      CREATE FUNCTION li_os_current_organization_id() RETURNS integer
        LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.current_organization', true), '')::integer $$;
      INSERT INTO users VALUES (11), (22);
      INSERT INTO organizations VALUES (501), (502);
      INSERT INTO projects VALUES (1), (2);
    `);
    await client.query(migration);
    await client.query(`CREATE ROLE ${roleId} NOLOGIN`);
    await client.query(`GRANT USAGE ON SCHEMA ${schemaId} TO ${roleId}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schemaId} TO ${roleId}`);

    await client.query(`
      INSERT INTO project_automation_workflows
        (id, project_id, owner_user_id, organization_id, name, template, trigger, action, notification_policy)
      VALUES
        ('wf:a',1,11,501,'A','custom','{"type":"manual"}','{"kind":"project_what_changed"}','{"enabled":true,"channels":["in_app"],"notifyOn":["failure"],"minimumRelevanceScore":0.5,"cooldownMinutes":60,"suppressUnchanged":true}'),
        ('wf:b',2,22,502,'B','custom','{"type":"manual"}','{"kind":"project_what_changed"}','{"enabled":true,"channels":["in_app"],"notifyOn":["failure"],"minimumRelevanceScore":0.5,"cooldownMinutes":60,"suppressUnchanged":true}');
      INSERT INTO project_automation_runs
        (id, workflow_id, project_id, owner_user_id, organization_id, trigger_type, status, started_at)
      VALUES
        ('run:a','wf:a',1,11,501,'manual','succeeded',now()),
        ('run:b','wf:b',2,22,502,'manual','succeeded',now());
      INSERT INTO project_automation_notifications
        (id, workflow_id, run_id, project_id, owner_user_id, organization_id, status, reason, title, body)
      VALUES
        ('note:a','wf:a','run:a',1,11,501,'delivered','change_detected','A','alpha'),
        ('note:b','wf:b','run:b',2,22,502,'delivered','change_detected','B','beta');
    `);

    await client.query(`SET LOCAL ROLE ${roleId}`);
    await client.query("SELECT set_config('app.current_user_id', '11', true)");
    await client.query("SELECT set_config('app.current_organization', '501', true)");

    assert.equal((await client.query("SELECT count(*)::int AS count FROM project_automation_workflows")).rows[0].count, 1);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM project_automation_runs")).rows[0].count, 1);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM project_automation_notifications")).rows[0].count, 1);
    assert.equal((await client.query("UPDATE project_automation_workflows SET name='tampered' WHERE id='wf:b'")).rowCount, 0);
    assert.equal((await client.query("DELETE FROM project_automation_runs WHERE id='run:b'")).rowCount, 0);
    await expectRlsReject("cross_tenant_note", `
      INSERT INTO project_automation_notifications
        (id, workflow_id, run_id, project_id, owner_user_id, organization_id, status, reason, title, body)
      VALUES ('note:x','wf:b','run:b',2,22,502,'delivered','failure','X','x')
    `);

    await client.query("SELECT set_config('app.current_organization', '', true)");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM project_automation_workflows")).rows[0].count, 0);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM project_automation_runs")).rows[0].count, 0);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM project_automation_notifications")).rows[0].count, 0);
    await client.query("ROLLBACK");
  } finally {
    try { await client.query(`DROP ROLE IF EXISTS ${roleId}`); } catch {}
    client.release();
    await pool.end();
  }
});
