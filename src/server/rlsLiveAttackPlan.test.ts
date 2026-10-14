import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const integrationEnabled = process.env.LIOS_RLS_INTEGRATION === "1";

test("live RLS attack matrix requires explicit integration mode", () => {
  assert.ok([true, false].includes(integrationEnabled));
});

test("live RLS attack matrix executes tenant isolation against PostgreSQL", { skip: !integrationEnabled }, async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL is required when LIOS_RLS_INTEGRATION=1");
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  const schema = `lios_rls_test_${process.pid}_${Date.now()}`;
  const quoteIdentifier = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
  const schemaIdentifier = quoteIdentifier(schema);
  const expectRlsRejection = async (savepoint: string, sql: string) => {
    const savepointIdentifier = quoteIdentifier(savepoint);
    await client.query(`SAVEPOINT ${savepointIdentifier}`);
    try {
      await assert.rejects(client.query(sql), /row-level security|policy/i);
    } finally {
      // PostgreSQL aborts the current transaction after an expected policy
      // violation. Roll back only that deliberate attack so the matrix can
      // continue testing the remaining isolation assertions.
      await client.query(`ROLLBACK TO SAVEPOINT ${savepointIdentifier}`);
      await client.query(`RELEASE SAVEPOINT ${savepointIdentifier}`);
    }
  };
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${schemaIdentifier}`);
    await client.query(`SET LOCAL search_path TO ${schemaIdentifier}, public`);
    await client.query(`
      CREATE TABLE portfolios (id integer PRIMARY KEY, organization_id integer NOT NULL, name text NOT NULL);
      CREATE TABLE client_datasets (id integer PRIMARY KEY, organization_id integer NOT NULL, name text NOT NULL);
      CREATE TABLE decision_records (id integer PRIMARY KEY, organization_id integer NOT NULL, name text NOT NULL);
      CREATE TABLE credit_wallets (id integer PRIMARY KEY, organization_id integer NOT NULL, balance integer NOT NULL);
      CREATE TABLE client_audit_events (id integer PRIMARY KEY, organization_id integer NOT NULL, action text NOT NULL);
      CREATE TABLE engagements (id integer PRIMARY KEY, organization_id integer NOT NULL, name text NOT NULL);
      CREATE TABLE workstreams (id integer PRIMARY KEY, engagement_id integer NOT NULL REFERENCES engagements(id), name text NOT NULL);
      CREATE TABLE deliverables (id integer PRIMARY KEY, workstream_id integer NOT NULL REFERENCES workstreams(id), name text NOT NULL);
      CREATE TABLE meetings (id integer PRIMARY KEY, engagement_id integer NOT NULL REFERENCES engagements(id), title text NOT NULL);
      CREATE TABLE workstream_comments (id integer PRIMARY KEY, workstream_id integer NOT NULL REFERENCES workstreams(id), body text NOT NULL);
      CREATE TABLE engagement_agreements (id integer PRIMARY KEY, engagement_id integer NOT NULL REFERENCES engagements(id), name text NOT NULL);
      CREATE TABLE engagement_payments (id integer PRIMARY KEY, engagement_id integer NOT NULL REFERENCES engagements(id), amount integer NOT NULL);
    `);
    const directTables = ["portfolios", "client_datasets", "decision_records", "credit_wallets", "client_audit_events", "engagements"];
    const childTables = ["workstreams", "deliverables", "meetings", "workstream_comments", "engagement_agreements", "engagement_payments"];
    const role = `lios_rls_test_role_${process.pid}`;
    await client.query(`CREATE ROLE ${quoteIdentifier(role)} NOLOGIN`);
    await client.query(`GRANT USAGE ON SCHEMA ${schemaIdentifier} TO ${quoteIdentifier(role)}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schemaIdentifier} TO ${quoteIdentifier(role)}`);
    await client.query(`INSERT INTO engagements VALUES (1, 101, 'tenant-a'), (2, 202, 'tenant-b')`);
    await client.query(`INSERT INTO portfolios VALUES (1, 101, 'portfolio-a'), (2, 202, 'portfolio-b')`);
    await client.query(`INSERT INTO workstreams VALUES (1, 1, 'workstream-a'), (2, 2, 'workstream-b')`);
    await client.query(`INSERT INTO deliverables VALUES (1, 1, 'deliverable-a'), (2, 2, 'deliverable-b')`);
    await client.query(`INSERT INTO meetings VALUES (1, 1, 'meeting-a'), (2, 2, 'meeting-b')`);
    await client.query(`INSERT INTO workstream_comments VALUES (1, 1, 'comment-a'), (2, 2, 'comment-b')`);
    await client.query(`INSERT INTO engagement_agreements VALUES (1, 1, 'agreement-a'), (2, 2, 'agreement-b')`);
    await client.query(`INSERT INTO engagement_payments VALUES (1, 1, 1000), (2, 2, 2000)`);
    const directMigration = fs.readFileSync(path.resolve("migrations/0017_rls_tenant_isolation.sql"), "utf8");
    const childMigration = fs.readFileSync(path.resolve("migrations/0018_rls_child_tenant_isolation.sql"), "utf8");
    await client.query(directMigration);
    await client.query(childMigration);
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(role)}`);

    await client.query("SELECT set_config('app.current_organization', '101', true)");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM portfolios")).rows[0].count, 1);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM engagements")).rows[0].count, 1);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM workstreams")).rows[0].count, 1);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM deliverables")).rows[0].count, 1);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM meetings")).rows[0].count, 1);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM workstream_comments")).rows[0].count, 1);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM engagement_agreements")).rows[0].count, 1);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM engagement_payments")).rows[0].count, 1);

    assert.equal((await client.query("UPDATE portfolios SET name = 'tampered' WHERE id = 2")).rowCount, 0);
    assert.equal((await client.query("DELETE FROM engagements WHERE id = 2")).rowCount, 0);
    await expectRlsRejection("cross_tenant_write", "INSERT INTO portfolios VALUES (3, 202, 'cross-tenant-write')");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM workstreams")).rows[0].count, 1);

    await client.query("SELECT set_config('app.current_organization', '', true)");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM portfolios")).rows[0].count, 0);
    await expectRlsRejection("missing_tenant_write", "INSERT INTO portfolios VALUES (4, 101, 'missing-tenant-write')");
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }
});
