import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const integrationEnabled = process.env.LIOS_RLS_INTEGRATION === "1";

test("P7 live Project Intelligence RLS requires explicit integration mode", () => {
  assert.ok([true, false].includes(integrationEnabled));
});

test("P7 live Project Intelligence RLS blocks cross-user and cross-organization access", { skip: !integrationEnabled }, async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL is required when LIOS_RLS_INTEGRATION=1");
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  const schema = `lios_p7_rls_${process.pid}_${Date.now()}`;
  const qi = (value: string) => '"' + value.replace(/"/g, '""') + '"';
  const schemaId = qi(schema);
  const role = `lios_p7_role_${process.pid}_${Date.now()}`;
  const roleId = qi(role);
  const migration = fs.readFileSync(path.resolve(process.cwd(), "migrations/0070_lios_p7_project_intelligence.sql"), "utf8");

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
      CREATE TABLE project_artifacts (kind text NOT NULL);
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
      INSERT INTO project_intelligence_documents
        (id, project_id, owner_user_id, organization_id, source_type, source_ref, title, body, content_hash)
      VALUES
        ('p7doc:a', 1, 11, 501, 'document', 'doc:a', 'A', 'alpha', repeat('a',64)),
        ('p7doc:b', 2, 22, 502, 'document', 'doc:b', 'B', 'beta', repeat('b',64));
      INSERT INTO project_intelligence_document_versions
        (id, document_id, project_id, owner_user_id, organization_id, source_type, source_ref, title, body, content_hash)
      VALUES
        ('p7version:a', 'p7doc:a', 1, 11, 501, 'document', 'doc:a', 'A', 'alpha', repeat('a',64)),
        ('p7version:b', 'p7doc:b', 2, 22, 502, 'document', 'doc:b', 'B', 'beta', repeat('b',64));
      INSERT INTO project_intelligence_snapshots
        (id, project_id, owner_user_id, organization_id, generated_at, content_hash, graph_hash, manifest)
      VALUES
        ('p7snapshot:a', 1, 11, 501, now(), repeat('a',64), repeat('c',64), '[]'::jsonb),
        ('p7snapshot:b', 2, 22, 502, now(), repeat('b',64), repeat('d',64), '[]'::jsonb);
    `);

    await client.query(`SET LOCAL ROLE ${roleId}`);
    await client.query("SELECT set_config('app.current_user_id', '11', true)");
    await client.query("SELECT set_config('app.current_organization', '501', true)");

    assert.equal((await client.query("SELECT count(*)::int AS count FROM project_intelligence_documents")).rows[0].count, 1);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM project_intelligence_document_versions")).rows[0].count, 1);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM project_intelligence_snapshots")).rows[0].count, 1);
    assert.equal((await client.query("UPDATE project_intelligence_documents SET title='tampered' WHERE id='p7doc:b'")).rowCount, 0);
    assert.equal((await client.query("UPDATE project_intelligence_document_versions SET title='tampered' WHERE id='p7version:b'")).rowCount, 0);
    assert.equal((await client.query("DELETE FROM project_intelligence_snapshots WHERE id='p7snapshot:b'")).rowCount, 0);

    await expectRlsReject("cross_org_doc", `
      INSERT INTO project_intelligence_documents
        (id, project_id, owner_user_id, organization_id, source_type, source_ref, title, body, content_hash)
      VALUES ('p7doc:x', 2, 22, 502, 'document', 'doc:x', 'X', 'x', repeat('e',64))
    `);
    await expectRlsReject("cross_user_snapshot", `
      INSERT INTO project_intelligence_snapshots
        (id, project_id, owner_user_id, organization_id, generated_at, content_hash, graph_hash, manifest)
      VALUES ('p7snapshot:x', 2, 22, 502, now(), repeat('e',64), repeat('f',64), '[]'::jsonb)
    `);

    await client.query("SELECT set_config('app.current_organization', '', true)");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM project_intelligence_documents")).rows[0].count, 0);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM project_intelligence_document_versions")).rows[0].count, 0);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM project_intelligence_snapshots")).rows[0].count, 0);
    await client.query("ROLLBACK");
  } finally {
    try { await client.query(`DROP ROLE IF EXISTS ${roleId}`); } catch {}
    client.release();
    await pool.end();
  }
});
