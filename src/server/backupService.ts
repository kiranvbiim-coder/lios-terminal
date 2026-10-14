import { notifyDataChanged } from "./gatewayRuntime";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import packageJson from "../package.json";
import { createBackup, restoreTestBackup, verifyBackup, type BackupManifest, type RestoreTestResult } from "./backupArchive";
import { deleteVaultCredential, getVaultCredential, setVaultCredential } from "./credentialVault";
import { getDb } from "./db";
import { dataRoot, stateDir } from "./dataRoot";

/**
 * GM-06b: scheduled and on-demand backups of a running Home, with an explicit, persisted failure state.
 * The archive engine is GM-06 (`backupArchive.ts`); this module owns settings, the schedule and the status.
 */

const PASSPHRASE_VAULT_NAME = "backup_passphrase";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export const backupSettingsSchema = z.object({
  enabled: z.boolean(),
  destination: z.string().min(1).max(1024).nullable(),
  /** false = plain tar.gz without key material. true = passphrase-encrypted, includes the vault and storage keys. */
  encrypt: z.boolean(),
  keep: z.number().int().min(1).max(365),
  intervalHours: z.number().int().min(1).max(24 * 30),
});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { enabled: false, destination: null, encrypt: true, keep: 7, intervalHours: 24 };

export interface BackupStatus {
  running: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFile: string | null;
  lastEntries: number | null;
  lastError: string | null;
  lastRestoreTest: { at: string; ok: boolean; rows: number; message: string } | null;
}

export class BackupConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupConfigurationError";
  }
}

function settingsFile(): string {
  return path.join(stateDir(), "backup-settings.json");
}
function statusFile(): string {
  return path.join(stateDir(), "backup-status.json");
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function readBackupSettings(): BackupSettings {
  const parsed = backupSettingsSchema.safeParse(readJson(settingsFile(), null));
  return parsed.success ? parsed.data : DEFAULT_BACKUP_SETTINGS;
}

const idleStatus: BackupStatus = { running: false, lastAttemptAt: null, lastSuccessAt: null, lastFile: null, lastEntries: null, lastError: null, lastRestoreTest: null };
let running = false;

export function readBackupStatus(): BackupStatus & { passphraseSet: boolean } {
  const stored = readJson<Partial<BackupStatus>>(statusFile(), {});
  return { ...idleStatus, ...stored, running, passphraseSet: getVaultCredential(PASSPHRASE_VAULT_NAME) !== null };
}

function patchStatus(patch: Partial<BackupStatus>): void {
  const { running: _running, ...stored } = { ...idleStatus, ...readJson<Partial<BackupStatus>>(statusFile(), {}), ...patch };
  writeJson(statusFile(), stored);
}

/** Validates and saves settings. A passphrase is stored only in the local vault and is never returned by any API. */
export function saveBackupSettings(input: unknown, passphrase?: string): BackupSettings {
  const settings = backupSettingsSchema.parse(input);
  if (settings.destination !== null) {
    if (!path.isAbsolute(settings.destination)) throw new BackupConfigurationError("The backup folder must be an absolute path.");
    const root = dataRoot();
    const destination = path.resolve(settings.destination);
    if (destination === root || destination.startsWith(`${root}${path.sep}`)) {
      throw new BackupConfigurationError("Choose a backup folder outside the LiOS data folder; a backup next to the data it protects is lost with it.");
    }
  }
  if (passphrase !== undefined && passphrase.length < 12) throw new BackupConfigurationError("The backup passphrase must be at least 12 characters.");
  if (settings.enabled && settings.destination === null) throw new BackupConfigurationError("Choose a backup folder to enable scheduled backups.");
  if (settings.encrypt && settings.enabled && passphrase === undefined && getVaultCredential(PASSPHRASE_VAULT_NAME) === null) {
    throw new BackupConfigurationError("Set a backup passphrase to enable encrypted backups.");
  }
  // Every check has passed; only now touch the vault and the settings file.
  if (passphrase !== undefined) setVaultCredential(PASSPHRASE_VAULT_NAME, passphrase, "Backup passphrase");
  if (!settings.encrypt) deleteVaultCredential(PASSPHRASE_VAULT_NAME);
  writeJson(settingsFile(), settings);
  return settings;
}

function currentPassphrase(settings: BackupSettings): string | undefined {
  if (!settings.encrypt) return undefined;
  const passphrase = getVaultCredential(PASSPHRASE_VAULT_NAME);
  if (passphrase === null) throw new BackupConfigurationError("The backup passphrase is missing; set it again in backup settings.");
  return passphrase;
}

/** One backup at a time. The outcome, success or failure, is always persisted so a failure is never silent. */
export async function runBackupNow(): Promise<{ file: string; manifest: BackupManifest }> {
  if (running) throw new BackupConfigurationError("A backup is already running.");
  const settings = readBackupSettings();
  running = true;
  patchStatus({ lastAttemptAt: new Date().toISOString() });
  notifyDataChanged("backup", { homeOwner: true });
  try {
    if (settings.destination === null) throw new BackupConfigurationError("Choose a backup folder first.");
    const result = await createBackup(getDb(), {
      destination: settings.destination,
      engine: process.env.DATABASE_URL ? "postgres" : "pglite",
      liosVersion: process.env.LIOS_PUBLIC_VERSION ?? packageJson.version,
      passphrase: currentPassphrase(settings),
      keep: settings.keep,
    });
    patchStatus({ lastSuccessAt: new Date().toISOString(), lastFile: result.file, lastEntries: result.manifest.entries.length, lastError: null });
    return { file: result.file, manifest: result.manifest };
  } catch (error) {
    patchStatus({ lastError: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    running = false;
    notifyDataChanged("backup", { homeOwner: true });
  }
}

/** Verifies the newest backup end to end and proves it restores into a scratch database. */
export async function restoreTestLatest(): Promise<RestoreTestResult & { file: string }> {
  const status = readBackupStatus();
  const settings = readBackupSettings();
  if (!status.lastFile || !fs.existsSync(status.lastFile)) throw new BackupConfigurationError("There is no backup to test yet.");
  try {
    const passphrase = currentPassphrase(settings);
    await verifyBackup(status.lastFile, { passphrase });
    const result = await restoreTestBackup(status.lastFile, { passphrase });
    patchStatus({ lastRestoreTest: { at: new Date().toISOString(), ok: result.digestsMatch, rows: result.rows, message: result.digestsMatch ? "Restored into a scratch database; every table matched." : "Restored, but a table did not match the backup." } });
    return { ...result, file: status.lastFile };
  } catch (error) {
    patchStatus({ lastRestoreTest: { at: new Date().toISOString(), ok: false, rows: 0, message: error instanceof Error ? error.message : String(error) } });
    throw error;
  } finally {
    notifyDataChanged("backup", { homeOwner: true });
  }
}

function due(settings: BackupSettings, status: BackupStatus, now: number): boolean {
  if (!settings.enabled || settings.destination === null) return false;
  const last = status.lastSuccessAt ? Date.parse(status.lastSuccessAt) : 0;
  const lastAttempt = status.lastAttemptAt ? Date.parse(status.lastAttemptAt) : 0;
  // A failed attempt is retried after an hour, not every check, so a full disk does not spin.
  return now - last >= settings.intervalHours * 3_600_000 && now - lastAttempt >= Math.min(3_600_000, settings.intervalHours * 3_600_000);
}

let timer: NodeJS.Timeout | null = null;

export function startBackupScheduler(): void {
  if (timer) return;
  const tick = (): void => {
    if (running || !due(readBackupSettings(), readBackupStatus(), Date.now())) return;
    runBackupNow().catch((error: unknown) => console.warn(`Scheduled backup failed: ${error instanceof Error ? error.message : String(error)}`));
  };
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
  setTimeout(tick, 30_000).unref();
}

export function stopBackupScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export const backupDueForTest = due;
