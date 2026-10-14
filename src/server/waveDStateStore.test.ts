import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-wave-d-state-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { getWaveDState, updateWaveDState } = await import("./waveDStateStore");

test("Wave D state persists under the existing user preference boundary", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [user] = await getDb().insert(users).values({
    email: "wave-d-state-test@limuria.local",
    passwordHash: "not-a-real-hash",
    role: "internal_admin",
    organizationId: null,
    name: "Wave D State Test",
  }).returning();
  const actor = { id: user.id, email: user.email, role: user.role, organizationId: user.organizationId } as const;

  await updateWaveDState(actor, (current) => ({
    ...current,
    inboxStatuses: { ...current.inboxStatuses, "inbox:signal:price": "snoozed" },
  }));
  const state = await getWaveDState(actor);
  assert.equal(state.inboxStatuses["inbox:signal:price"], "snoozed");
  assert.ok(state.updatedAt);
});
