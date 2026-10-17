import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { RESTORE_STATE_DIRECTORY, restoreRecoveryMessage } from "./backupRestoreState";

const journalSchema = z.object({
  version: z.literal(1),
  root: z.string(),
  ownerPid: z.number().int().positive(),
  phase: z.enum(["preparing", "prepared", "publishing", "committing", "rolling_back", "complete", "rolled_back"]),
  staging: z.string().regex(/^\.lios-restore-[a-zA-Z0-9-]+$/),
  previous: z.string().regex(/^restore-previous-[a-zA-Z0-9-]+$/),
  files: z.array(z.object({
    relative: z.string(),
    original: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), mode: z.number().int(), atime: z.number(), mtime: z.number() }).nullable(),
  })),
  createdDirectories: z.array(z.string()),
}).strict();
type RestoreJournal = z.infer<typeof journalSchema>;
export type RestoreTargetCheck = (root: string, relative: string) => string;

export function syncRestorePath(file: string): void {
  let fd: number;
  try { fd = fs.openSync(file, "r"); } catch (error) {
    // Windows does not expose directory handles through openSync. File data
    // is still flushed; sudden power-loss durability there is not POSIX fsync.
    if (process.platform === "win32" && fs.lstatSync(file).isDirectory()
      && ["EISDIR", "EPERM", "EACCES"].includes(String((error as NodeJS.ErrnoException).code))) return;
    throw error;
  }
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function syncRestoreTree(directory: string): void {
  const rootEntry = fs.lstatSync(directory);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) throw new Error("Restore recovery directory is not a real directory.");
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) syncRestoreTree(file);
    else if (entry.isFile() && !entry.isSymbolicLink()) syncRestorePath(file);
    else throw new Error("Restore recovery refuses linked or special files.");
  }
  syncRestorePath(directory);
}

function digest(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** This is a transaction journal over the existing logical export and prior-file copies, not another backup format. */
export class HomeRestoreRecovery {
  readonly directory: string;
  private constructor(readonly root: string, readonly journal: RestoreJournal) {
    this.directory = path.join(root, RESTORE_STATE_DIRECTORY);
  }

  static reserve(root: string, staging: string, previous: string): HomeRestoreRecovery {
    const directory = path.join(root, RESTORE_STATE_DIRECTORY);
    try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(restoreRecoveryMessage(root));
      throw error;
    }
    const recovery = new HomeRestoreRecovery(root, {
      version: 1, root: fs.realpathSync(root), ownerPid: process.pid, phase: "preparing",
      staging: path.basename(staging), previous: path.basename(previous), files: [], createdDirectories: [],
    });
    recovery.persist();
    syncRestorePath(root);
    return recovery;
  }

  static open(root: string, check: RestoreTargetCheck): HomeRestoreRecovery {
    const directory = path.join(root, RESTORE_STATE_DIRECTORY);
    const entry = fs.lstatSync(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Restore recovery state is not a real private directory; preserve it for operator inspection.");
    const file = path.join(directory, "journal.json");
    const journalFile = fs.lstatSync(file);
    if (!journalFile.isFile() || journalFile.isSymbolicLink()) throw new Error("Restore recovery journal is missing or unsafe; no Home mutation is authorized.");
    const journal = journalSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (journal.root !== fs.realpathSync(root)) throw new Error("Restore recovery journal belongs to another physical Home.");
    for (const item of journal.files) {
      check(root, item.relative);
      if (item.original) check(path.join(root, journal.previous), item.relative);
    }
    for (const relative of journal.createdDirectories) {
      const target = path.resolve(root, relative);
      if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("Unsafe recovery directory path.");
    }
    return new HomeRestoreRecovery(root, journal);
  }

  get priorDatabase(): string { return path.join(this.directory, "prior-db"); }
  get previousDirectory(): string { return path.join(this.root, this.journal.previous); }

  private persist(): void {
    const temporary = path.join(this.directory, `journal-${crypto.randomUUID()}.tmp`);
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(this.journal)}\n`);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, path.join(this.directory, "journal.json"));
    syncRestorePath(this.directory);
  }

  phase(phase: RestoreJournal["phase"]): void {
    this.journal.phase = phase;
    this.persist();
  }

  claimRecovery(): () => void {
    const live = (pid: number): boolean => {
      try { process.kill(pid, 0); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
    };
    if (this.journal.ownerPid !== process.pid && live(this.journal.ownerPid)) throw new Error("The original restore process is still active; stop it before recovery.");
    const marker = path.join(this.directory, "recovery-owner.json");
    const existing = fs.lstatSync(marker, { throwIfNoEntry: false });
    if (existing) {
      if (!existing.isFile() || existing.isSymbolicLink() || existing.size > 8192) throw new Error("Restore recovery ownership marker is unsafe.");
      const owner = z.object({ pid: z.number().int().positive(), token: z.string().uuid() }).strict().parse(JSON.parse(fs.readFileSync(marker, "utf8")));
      if (live(owner.pid)) throw new Error("Another recovery process is still active.");
      const current = fs.lstatSync(marker);
      if (current.dev !== existing.dev || current.ino !== existing.ino) throw new Error("Restore recovery ownership changed; retry after inspection.");
      fs.unlinkSync(marker);
    }
    const token = crypto.randomUUID();
    const fd = fs.openSync(marker, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    syncRestorePath(this.directory);
    this.journal.ownerPid = process.pid;
    this.persist();
    return () => {
      try {
        if (JSON.parse(fs.readFileSync(marker, "utf8")).token === token) { fs.unlinkSync(marker); syncRestorePath(this.directory); }
      } catch { /* Retired recovery state no longer contains a marker; never delete an unknown owner's file. */ }
    };
  }

  discardUnprepared(): void {
    if (this.journal.phase !== "preparing" || this.journal.ownerPid !== process.pid) throw new Error("Only this process's unprepared restore reservation may be discarded.");
    fs.rmSync(this.directory, { recursive: true });
    fs.rmSync(this.previousDirectory, { recursive: true });
    syncRestorePath(this.root);
  }

  prepareFiles(relatives: string[], check: RestoreTargetCheck): void {
    for (const relative of relatives) {
      const target = check(this.root, relative);
      const entry = fs.lstatSync(target, { throwIfNoEntry: false });
      let original: RestoreJournal["files"][number]["original"] = null;
      if (entry) {
        const keep = check(this.previousDirectory, relative);
        fs.mkdirSync(path.dirname(keep), { recursive: true, mode: 0o700 });
        fs.copyFileSync(target, keep, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(keep, entry.mode & 0o777);
        original = { sha256: digest(keep), mode: entry.mode & 0o777, atime: entry.atimeMs, mtime: entry.mtimeMs };
        if (digest(target) !== original.sha256) throw new Error(`Home file changed during restore preparation: ${relative}`);
      }
      this.journal.files.push({ relative, original });
      let parent = path.dirname(target);
      while (parent !== path.resolve(this.root) && !fs.lstatSync(parent, { throwIfNoEntry: false })) {
        const directory = path.relative(this.root, parent);
        if (!this.journal.createdDirectories.includes(directory)) this.journal.createdDirectories.push(directory);
        parent = path.dirname(parent);
      }
    }
    syncRestoreTree(this.previousDirectory);
    syncRestoreTree(this.priorDatabase);
    this.phase("prepared");
  }

  publish(relative: string, source: string, check: RestoreTargetCheck): void {
    const target = check(this.root, relative);
    const expected = this.journal.files.find((item) => item.relative === relative);
    if (!expected) throw new Error("Restore target was not included in the durable recovery journal.");
    const current = fs.lstatSync(target, { throwIfNoEntry: false });
    if (expected.original ? !current || digest(target) !== expected.original.sha256 : Boolean(current)) {
      throw new Error(`Home file changed after restore preparation: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    check(this.root, relative);
    syncRestorePath(source);
    fs.renameSync(source, target);
    syncRestorePath(target);
    syncRestorePath(path.dirname(target));
  }

  /** Idempotent: retain all displaced bytes, including unexpected writer bytes; never recursively delete Home paths. */
  rollbackFiles(check: RestoreTargetCheck): void {
    for (const item of [...this.journal.files].reverse()) {
      const target = check(this.root, item.relative);
      const current = fs.lstatSync(target, { throwIfNoEntry: false });
      const keep = item.original ? check(this.previousDirectory, item.relative) : null;
      if (keep && digest(keep) !== item.original?.sha256) throw new Error(`Prior restore file is damaged: ${item.relative}`);
      if (current && item.original && digest(target) === item.original.sha256) continue;
      if (!current && !item.original) continue;
      const temporary = path.join(this.directory, `rollback-${crypto.randomUUID()}`);
      if (keep && item.original) {
        fs.copyFileSync(keep, temporary, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(temporary, item.original.mode);
        fs.utimesSync(temporary, item.original.atime / 1000, item.original.mtime / 1000);
        syncRestorePath(temporary);
      }
      if (current) {
        const displaced = path.join(this.directory, `displaced-${crypto.randomUUID()}`);
        fs.renameSync(target, displaced);
        syncRestorePath(this.directory);
        syncRestorePath(path.dirname(target));
      }
      if (keep) {
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        check(this.root, item.relative);
        fs.renameSync(temporary, target);
        syncRestorePath(target);
        syncRestorePath(path.dirname(target));
      }
    }
    for (const relative of [...this.journal.createdDirectories].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length)) {
      const directory = path.join(this.root, relative);
      const entry = fs.lstatSync(directory, { throwIfNoEntry: false });
      if (!entry) continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Recovery directory changed: ${relative}`);
      fs.rmdirSync(directory); // A new/unrelated file blocks recovery rather than being deleted.
      syncRestorePath(path.dirname(directory));
    }
  }

  retire(phase: "complete" | "rolled_back"): string {
    this.phase(phase);
    const retained = path.join(this.root, `.lios-restore-${phase}-${crypto.randomUUID()}`);
    fs.renameSync(this.directory, retained);
    syncRestorePath(this.root);
    return retained;
  }
}
