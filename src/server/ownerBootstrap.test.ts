import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sql } from "drizzle-orm";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-owner-bootstrap-"));
process.env.LIOS_DATA_ROOT = root;
process.env.HOME = path.join(root, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
delete process.env.DATABASE_URL;

const { closeDb, getDb, initDb } = await import("./db");
const { createBootstrapAdministrator, initializeServerHomeOwner, OwnerBootstrapConflictError } = await import("./auth");
const { users } = await import("@shared/schema");

const resetUsers = () => getDb().execute(sql`TRUNCATE TABLE "users" CASCADE`);
const strong = "Zx9!kQ4#vLm2$Rt8";

test.before(async () => {
  await initDb();
});
test.after(async () => {
  await closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

test("only one of several concurrent server-Home owner enrollments succeeds", async () => {
  const attempts = await Promise.allSettled(
    ["a", "b", "c"].map((id) =>
      createBootstrapAdministrator({ email: `${id}@example.test`, name: `Owner ${id}`, password: strong }, true),
    ),
  );
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  for (const attempt of attempts) {
    if (attempt.status === "rejected") assert.ok(attempt.reason instanceof OwnerBootstrapConflictError);
  }
  assert.equal((await getDb().select().from(users)).length, 1);
});

test("a Home with accounts refuses a second enrollment and clears a stale setup token", async () => {
  const tokenFile = path.join(root, "owner-setup.token");
  fs.writeFileSync(tokenFile, JSON.stringify({ token: "t".repeat(43), createdAt: new Date().toISOString() }), { mode: 0o600 });
  await initializeServerHomeOwner({ HOST: "0.0.0.0" });
  assert.equal(fs.existsSync(tokenFile), false);
  await assert.rejects(
    createBootstrapAdministrator({ email: "late@example.test", name: "Late Owner", password: strong }, true),
    OwnerBootstrapConflictError,
  );
});

test("desktop enrollment still rotates the legacy administrator in place and rejects the legacy email", async () => {
  await resetUsers();
  await getDb().insert(users).values({
    email: "admin@limuria.com",
    passwordHash: "legacy",
    role: "internal_admin",
    name: "Admin",
    active: true,
    mustChangePassword: true,
  });
  await assert.rejects(
    createBootstrapAdministrator({ email: "admin@limuria.com", name: "Legacy Again", password: strong }, false),
    OwnerBootstrapConflictError,
  );
  const rotated = await createBootstrapAdministrator({ email: "me@example.test", name: "Desktop Owner", password: strong }, false);
  assert.equal(rotated.rotatedLegacy, true);
  assert.equal((await getDb().select().from(users)).length, 1);
  await assert.rejects(
    createBootstrapAdministrator({ email: "other@example.test", name: "Other Owner", password: strong }, false),
    OwnerBootstrapConflictError,
  );
});

test("Home startup creates a setup token only on an empty Home and never creates an account from it", async () => {
  await resetUsers();
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    await initializeServerHomeOwner({ HOST: "0.0.0.0" });
    await initializeServerHomeOwner({ HOST: "0.0.0.0" });
  } finally {
    console.log = original;
  }
  const tokenFile = path.join(root, "owner-setup.token");
  if (process.platform !== "win32") assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);
  assert.equal(lines.filter((line) => line.includes("one-time owner setup token")).length, 1, "printed once across restarts");
  assert.equal((await getDb().select().from(users)).length, 0);
});

test("automated owner setup needs both email and a password file and rejects weak files", async () => {
  await resetUsers();
  await assert.rejects(initializeServerHomeOwner({ HOST: "0.0.0.0", LIOS_OWNER_EMAIL: "ops@example.test" }), /must both be supplied/);
  const file = path.join(root, "pw");
  fs.writeFileSync(file, "short\n", { mode: 0o600 });
  await assert.rejects(initializeServerHomeOwner({ HOST: "0.0.0.0", LIOS_OWNER_EMAIL: "ops@example.test", LIOS_OWNER_PASSWORD_FILE: file }));
  assert.equal((await getDb().select().from(users)).length, 0);
  fs.writeFileSync(file, `${strong}\n`, { mode: 0o600 });
  await initializeServerHomeOwner({ HOST: "0.0.0.0", LIOS_OWNER_EMAIL: "ops@example.test", LIOS_OWNER_PASSWORD_FILE: file });
  const [owner] = await getDb().select().from(users);
  assert.equal(owner?.email, "ops@example.test");
  assert.equal(owner?.role, "internal_admin");
});
