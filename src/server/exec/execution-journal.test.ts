import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  EncryptedStorageProvider,
  FilesystemStorageProvider,
  StorageIntegrityError,
  StorageNotFoundError,
  loadOrCreateStorageKey,
} from "../storageProvider";
import { createExecutionJournal, type ExecutionJournalOptions, type ExecutionOwner } from "./execution-journal";

const OWNER: ExecutionOwner = { userId: 1, projectId: 2, chatId: 3 };
const IDS = [
  "550e8400-e29b-41d4-a716-446655440000",
  "550e8400-e29b-41d4-a716-446655440001",
  "550e8400-e29b-41d4-a716-446655440002",
] as const;

async function fixture(t: TestContext, limits: ExecutionJournalOptions = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-execution-journal-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { ...limits, directory: path.join(root, "execution-journal"), keyDirectory: path.join(root, "data") };
  const journal = await createExecutionJournal(options);
  return { root, options, journal };
}

async function encryptedFixture(options: ExecutionJournalOptions, id: string, value: unknown): Promise<void> {
  assert.ok(options.directory);
  const provider = new EncryptedStorageProvider(
    new FilesystemStorageProvider(options.directory),
    await loadOrCreateStorageKey(options.keyDirectory),
    { acceptPlaintext: false },
  );
  await provider.put(id, Buffer.from(JSON.stringify(value)));
}

test("restart discovers encrypted running records and atomically marks interruption without changing completed runs", async (t) => {
  const { journal, options } = await fixture(t);
  await journal.begin({ id: IDS[0], owner: OWNER, label: "Build project" });
  // Admission sees the durable running record, not a deferred in-memory write.
  const admitted = await createExecutionJournal(options);
  assert.equal((await admitted.read(IDS[0], OWNER))?.status, "running");
  await journal.append(IDS[0], "stdout", "private working output");
  await journal.begin({ id: IDS[1], owner: OWNER, label: "Finished task" });
  await journal.append(IDS[1], "stderr", "warning");
  await journal.finish(IDS[1], "completed", 0);
  const completed = await journal.read(IDS[1], OWNER);
  assert.ok(completed);

  // Stray indexes/temporary files do not control discovery or trigger recovery.
  await fs.writeFile(path.join(options.directory, "obsolete-index.json"), "invalid ignored index");
  const restarted = await createExecutionJournal(options);
  await restarted.recoverInterrupted();
  const interrupted = await restarted.read(IDS[0], OWNER);
  assert.equal(interrupted?.status, "interrupted");
  assert.equal(interrupted?.stdout, "private working output");
  assert.equal(interrupted?.exitCode, null);
  assert.ok(interrupted?.endedAt);
  assert.deepEqual(await restarted.read(IDS[1], OWNER), completed);
  await restarted.recoverInterrupted();
  assert.deepEqual(await restarted.read(IDS[0], OWNER), interrupted, "recovery is idempotent");
  await assert.rejects(restarted.append(IDS[0], "stdout", "must not resume"), /finalized/);
  await assert.rejects(restarted.finish(IDS[0], "completed", 0), /finalized/);
  assert.deepEqual((await fs.readdir(options.directory)).sort(), [IDS[0], IDS[1], "obsolete-index.json"]);
});

test("read and list require an exact user/project/chat owner match, including null fields", async (t) => {
  const { journal } = await fixture(t);
  await journal.begin({ id: IDS[0], owner: OWNER, label: "Private task" });
  await journal.append(IDS[0], "stdout", "foreign-private-transcript");
  for (const foreign of [
    { ...OWNER, userId: 9 }, { ...OWNER, projectId: 9 }, { ...OWNER, chatId: 9 },
    { ...OWNER, projectId: null }, { ...OWNER, chatId: null },
  ]) {
    assert.equal(await journal.read(IDS[0], foreign), null);
    assert.deepEqual(await journal.list(foreign), []);
  }
  const nullOwner = { userId: 1, projectId: null, chatId: null };
  await journal.begin({ id: IDS[1], owner: nullOwner, label: "Quick task" });
  assert.deepEqual((await journal.list(OWNER)).map((record) => record.id), [IDS[0]]);
  assert.deepEqual((await journal.list(nullOwner)).map((record) => record.id), [IDS[1]]);
  const visible = await journal.read(IDS[0], OWNER);
  assert.ok(visible);
  visible.owner.userId = 20;
  visible.stdout = "mutated by caller";
  assert.equal((await journal.read(IDS[0], OWNER))?.stdout, "foreign-private-transcript");
  assert.equal(await journal.read(IDS[2], OWNER), null);
});

test("canonical storage.key encrypts private output and display labels with private filesystem modes", async (t) => {
  const { journal, options, root } = await fixture(t);
  await journal.begin({ id: IDS[0], owner: OWNER, label: "Sensitive display title" });
  await journal.append(IDS[0], "stdout", "private financial figures 424242");
  const bytes = await fs.readFile(path.join(options.directory, IDS[0]));
  assert.equal(bytes.subarray(0, 8).toString(), "LIOSENC1");
  assert.equal(bytes.includes("private financial"), false);
  assert.equal(bytes.includes("Sensitive display"), false);
  assert.equal(bytes.includes('"owner"'), false);
  assert.deepEqual(await fs.readdir(options.keyDirectory), ["storage.key"]);
  assert.deepEqual((await fs.readdir(root)).sort(), ["data", "execution-journal"]);
  const provider = new EncryptedStorageProvider(
    new FilesystemStorageProvider(options.directory), await loadOrCreateStorageKey(options.keyDirectory),
    { acceptPlaintext: false },
  );
  const record = JSON.parse((await provider.get(IDS[0])).toString()) as Record<string, unknown>;
  assert.equal(record.stdout, "private financial figures 424242");
  assert.deepEqual(Object.keys(record).sort(), ["endedAt", "exitCode", "id", "label", "owner", "startedAt", "status", "stderr", "stdout", "version"]);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(options.directory)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(options.directory, IDS[0]))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.join(options.keyDirectory, "storage.key"))).mode & 0o777, 0o600);
  }
});

test("obvious credentials are redacted in transcripts and labels using existing LiOS guard shapes", async (t) => {
  const { journal } = await fixture(t);
  await journal.begin({ id: IDS[0], owner: OWNER, label: "password=label-secret build" });
  await journal.append(IDS[0], "stdout", 'api_key=key-secret password="space secret" access_token=token-secret Bearer bearer-secret\n');
  await journal.append(IDS[0], "stderr", "authorization: auth-secret secret='quoted secret'\n");
  // A credential name split across chunks is recognized when the value arrives.
  await journal.append(IDS[0], "stderr", "pass");
  await journal.append(IDS[0], "stderr", "word=split-secret\n");
  const record = await journal.read(IDS[0], OWNER);
  assert.ok(record);
  for (const secret of ["label-secret", "key-secret", "space secret", "token-secret", "bearer-secret", "auth-secret", "quoted secret", "split-secret"]) {
    assert.equal(JSON.stringify(record).includes(secret), false, secret);
  }
  assert.match(record.stdout, /api_key=\[REDACTED\]/);
  assert.match(record.stderr, /password=\[REDACTED\]/);
});

test("combined transcript cap keeps the newest output without splitting UTF-16 surrogate pairs", async (t) => {
  const { journal, options } = await fixture(t, { maxTranscriptChars: 7 });
  await journal.begin({ id: IDS[0], owner: OWNER, label: "x".repeat(255) + "😀" });
  await journal.append(IDS[0], "stdout", "😀abcdef");
  assert.equal((await journal.read(IDS[0], OWNER))?.stdout, "abcdef", "cut through a pair drops both units");
  await journal.append(IDS[0], "stderr", "😀xyz");
  let record = await journal.read(IDS[0], OWNER);
  assert.ok(record);
  assert.equal(record.stdout, "ef");
  assert.equal(record.stderr, "😀xyz");
  assert.equal(record.stdout.length + record.stderr.length, 7);
  assert.ok(record.label.length <= 256);
  assert.equal(record.label.startsWith("\uDE00"), false);
  await journal.append(IDS[0], "stdout", "a".repeat(50));
  record = await (await createExecutionJournal(options)).read(IDS[0], OWNER);
  assert.equal(record?.stdout, "aaaaaaa");
  assert.equal(record?.stderr, "");
});

test("default transcript budget is 256 Ki characters, combined across both streams", async (t) => {
  const { journal } = await fixture(t);
  await journal.begin({ id: IDS[0], owner: OWNER, label: "Bounded output" });
  await journal.append(IDS[0], "stdout", "x".repeat(256 * 1024 + 10));
  await journal.append(IDS[0], "stderr", "last error");
  const record = await journal.read(IDS[0], OWNER);
  assert.ok(record);
  assert.equal(record.stdout.length + record.stderr.length, 256 * 1024);
  assert.equal(record.stderr, "last error");
});

test("serialized concurrent output precedes finalization, and late writes cannot change a terminal record", async (t) => {
  const { journal } = await fixture(t);
  const begin = journal.begin({ id: IDS[0], owner: OWNER, label: "Concurrent task" });
  const outputs = Array.from({ length: 20 }, (_, index) => journal.append(IDS[0], "stdout", `${index},`));
  const stderr = journal.append(IDS[0], "stderr", "final diagnostic");
  const finish = journal.finish(IDS[0], "failed", 17);
  const late = assert.rejects(journal.append(IDS[0], "stdout", "late"), /finalized/);
  const finalRead = journal.read(IDS[0], OWNER);
  await Promise.all([begin, ...outputs, stderr, finish, late]);
  const record = await finalRead;
  assert.ok(record);
  assert.equal(record.stdout, Array.from({ length: 20 }, (_, index) => `${index},`).join(""));
  assert.equal(record.stderr, "final diagnostic");
  assert.equal(record.status, "failed");
  assert.equal(record.exitCode, 17);
  assert.ok(record.endedAt);
  await assert.rejects(journal.finish(IDS[0], "cancelled", null), /finalized/);
  assert.deepEqual(await journal.read(IDS[0], OWNER), record);
});

test("retention evicts only terminal runs, persists the boundary across restart, and refuses full active admission", async (t) => {
  const { journal, options } = await fixture(t, { maxRecords: 2 });
  await journal.begin({ id: IDS[0], owner: OWNER, label: "Still running" });
  await journal.begin({ id: IDS[1], owner: OWNER, label: "Cancelled" });
  await assert.rejects(journal.begin({ id: IDS[2], owner: OWNER, label: "Rejected" }), /full of running/);
  assert.equal((await journal.list(OWNER)).length, 2);
  assert.equal(await journal.read(IDS[2], OWNER), null);
  await journal.finish(IDS[1], "cancelled", null);
  await journal.begin({ id: IDS[2], owner: OWNER, label: "New run" });
  assert.ok(await journal.read(IDS[0], OWNER), "active execution is not evicted");
  assert.equal(await journal.read(IDS[1], OWNER), null);
  assert.ok(await journal.read(IDS[2], OWNER));
  assert.equal((await fs.readdir(options.directory)).length, 2);
  const restarted = await createExecutionJournal(options);
  await restarted.recoverInterrupted();
  assert.equal((await restarted.list(OWNER)).length, 2);
  assert.ok((await restarted.list(OWNER)).every((record) => record.status === "interrupted"));
});

test("retention removes the oldest completed run at the configured exact boundary", async (t) => {
  const { journal, options } = await fixture(t, { maxRecords: 2 });
  for (const id of IDS) {
    await journal.begin({ id, owner: OWNER, label: "Completed" });
    await journal.finish(id, "completed", 0);
  }
  assert.equal(await journal.read(IDS[0], OWNER), null);
  assert.deepEqual((await journal.list(OWNER)).map((record) => record.id), [IDS[2], IDS[1]]);
  assert.deepEqual((await fs.readdir(options.directory)).sort(), [IDS[1], IDS[2]]);
});

test("ciphertext tampering, moved objects, wrong master keys and plaintext downgrade fail visibly without repair", async (t) => {
  for (const scenario of ["tamper", "move", "key-swap", "plaintext"] as const) {
    await t.test(scenario, async (subtest) => {
      const { journal, options } = await fixture(subtest);
      await journal.begin({ id: IDS[0], owner: OWNER, label: "Private" });
      await journal.append(IDS[0], "stdout", "unchanged evidence");
      let id: string = IDS[0];
      const target = path.join(options.directory, IDS[0]);
      const bytes = await fs.readFile(target);
      if (scenario === "tamper") {
        const damaged = Buffer.from(bytes);
        damaged[damaged.length - 20] ^= 1;
        await fs.writeFile(target, damaged);
      } else if (scenario === "move") {
        id = IDS[1];
        await fs.copyFile(target, path.join(options.directory, id));
      } else if (scenario === "key-swap") {
        await fs.writeFile(path.join(options.keyDirectory, "storage.key"), `${crypto.randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
      } else {
        await fs.writeFile(target, '{"stdout":"plaintext secret"}');
      }
      const before = await fs.readFile(path.join(options.directory, id));
      const restarted = await createExecutionJournal(options);
      await assert.rejects(restarted.read(id, OWNER), StorageIntegrityError);
      await assert.rejects(restarted.list(OWNER), StorageIntegrityError);
      await assert.rejects(restarted.recoverInterrupted(), StorageIntegrityError);
      assert.deepEqual(await fs.readFile(path.join(options.directory, id)), before, "never repair or downgrade damaged storage");
    });
  }
});

test("authenticated malformed JSON/schema/state is rejected before recovery rewrites any run", async (t) => {
  const { journal, options } = await fixture(t);
  await journal.begin({ id: IDS[0], owner: OWNER, label: "Valid running record" });
  const valid = await journal.read(IDS[0], OWNER);
  assert.ok(valid);
  const original = await fs.readFile(path.join(options.directory, IDS[0]));
  for (const invalid of [
    { ...valid, id: IDS[1], version: 2 },
    { ...valid, id: IDS[1], owner: { ...OWNER, userId: "1" } },
    { ...valid, id: IDS[1], env: { PASSWORD: "must not persist" } },
    { ...valid, id: IDS[1], status: "running", exitCode: 0 },
    { ...valid, id: IDS[1], status: "completed", endedAt: null },
    { ...valid, id: IDS[0] },
  ]) {
    await encryptedFixture(options, IDS[1], invalid);
    await assert.rejects(journal.read(IDS[1], OWNER), StorageIntegrityError);
    await assert.rejects(journal.recoverInterrupted(), StorageIntegrityError);
    assert.deepEqual(await fs.readFile(path.join(options.directory, IDS[0])), original);
  }
  const provider = new EncryptedStorageProvider(new FilesystemStorageProvider(options.directory), await loadOrCreateStorageKey(options.keyDirectory));
  await provider.put(IDS[1], Buffer.from("{bad json"));
  await assert.rejects(journal.read(IDS[1], OWNER), /invalid JSON/);
});

test("UUID discovery never follows files, directories or linked journal roots, and invalid identifiers cannot traverse", async (t) => {
  const { journal, options, root } = await fixture(t);
  for (const id of ["../outside", "/tmp/outside", IDS[0].toUpperCase(), `${IDS[0]}/child`, "not-a-uuid"]) {
    await assert.rejects(journal.begin({ id, owner: OWNER, label: "Invalid" }), /UUID/);
    await assert.rejects(journal.read(id, OWNER), /UUID/);
  }
  await journal.begin({ id: IDS[0], owner: OWNER, label: "Safe run" });
  await fs.mkdir(path.join(options.directory, IDS[1]));
  await assert.rejects(journal.list(OWNER), /regular files/);
  await fs.rmdir(path.join(options.directory, IDS[1]));
  if (process.platform !== "win32") {
    await fs.symlink(path.join(options.directory, IDS[0]), path.join(options.directory, IDS[1]));
    await assert.rejects(journal.read(IDS[1], OWNER), /never links/);
    await assert.rejects(journal.recoverInterrupted(), /never links/);
    await fs.unlink(path.join(options.directory, IDS[1]));
    const linked = path.join(root, "linked-journal");
    await fs.symlink(options.directory, linked);
    await assert.rejects(createExecutionJournal({ ...options, directory: linked }), /symbolic link/);
    await fs.rename(options.directory, path.join(root, "previous-journal"));
    await fs.symlink(path.join(root, "previous-journal"), options.directory);
    await assert.rejects(journal.append(IDS[0], "stdout", "outside write"), /replaced or linked/);
  }
});

test("invalid limits and duplicate ids cannot change an admitted run, and rejected operations do not poison the queue", async (t) => {
  const { journal, options } = await fixture(t);
  for (const maxTranscriptChars of [0, -1, 1.5, Infinity, 256 * 1024 + 1]) {
    await assert.rejects(createExecutionJournal({ ...options, maxTranscriptChars }), /limit/);
  }
  for (const maxRecords of [0, -1, 1.5, 257]) {
    await assert.rejects(createExecutionJournal({ ...options, maxRecords }), /limit/);
  }
  await assert.rejects(journal.begin({ id: IDS[0], owner: { ...OWNER, userId: -1 }, label: "Bad owner" }), /owner/);
  const owner = { ...OWNER };
  const admitted = journal.begin({ id: IDS[0], owner, label: "Original" });
  owner.userId = 42;
  await admitted;
  await assert.rejects(journal.begin({ id: IDS[0], owner: OWNER, label: "Replacement" }), /already exists/);
  await assert.rejects(journal.append(IDS[1], "stdout", "missing"), StorageNotFoundError);
  await journal.append(IDS[0], "stdout", "still usable");
  await journal.finish(IDS[0], "completed", 0);
  assert.equal((await journal.read(IDS[0], OWNER))?.label, "Original");
  assert.equal((await journal.read(IDS[0], OWNER))?.stdout, "still usable");
});

test("default journal remains local with S3 selected and uses the canonical Home storage key", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-journal-local-"));
  const previousRoot = process.env.LIOS_DATA_ROOT;
  const previousProvider = process.env.LIOS_STORAGE_PROVIDER;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.LIOS_DATA_ROOT;
    else process.env.LIOS_DATA_ROOT = previousRoot;
    if (previousProvider === undefined) delete process.env.LIOS_STORAGE_PROVIDER;
    else process.env.LIOS_STORAGE_PROVIDER = previousProvider;
    await fs.rm(root, { recursive: true, force: true });
  });
  process.env.LIOS_DATA_ROOT = root;
  process.env.LIOS_STORAGE_PROVIDER = "s3";
  const journal = await createExecutionJournal();
  await journal.begin({ id: IDS[0], owner: OWNER, label: "Local execution" });
  assert.ok((await fs.stat(path.join(root, "execution-journal", IDS[0]))).isFile());
  assert.ok((await fs.stat(path.join(root, "data", "storage.key"))).isFile());
});
