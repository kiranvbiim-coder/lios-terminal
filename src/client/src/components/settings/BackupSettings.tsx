import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { serverErrorText } from "@/lib/apiErrorText";
import { describeBackupHealth, stripIpcErrorPrefix } from "@/lib/backupHealth";
import { getDesktopWorkspaceBridge } from "@/lib/desktopWorkspace";

interface BackupSettingsValues {
  enabled: boolean;
  destination: string | null;
  encrypt: boolean;
  keep: number;
  intervalHours: number;
}

interface BackupStatus {
  running: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFile: string | null;
  lastEntries: number | null;
  lastError: string | null;
  lastRestoreTest: { at: string; ok: boolean; rows: number; message: string } | null;
  passphraseSet: boolean;
}

interface BackupState {
  settings: BackupSettingsValues;
  status: BackupStatus;
}

interface RestoreTestResult {
  result: { tables: number; rows: number; digestsMatch: boolean; file: string };
  status: BackupStatus;
}

const BACKUP_KEY = ["/api/backup"];
const ADMIN_ROLES: Record<string, true> = { internal_admin: true, client_admin: true };
const MIN_PASSPHRASE_LENGTH = 12;

function formatTime(iso: string | null): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "unknown time";
}

export default function BackupSettings({ role }: { role: string }) {
  const queryClient = useQueryClient();
  const isAdmin = ADMIN_ROLES[role] === true;
  const desktop = getDesktopWorkspaceBridge();
  const [form, setForm] = useState<BackupSettingsValues | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const stateQuery = useQuery<BackupState>({
    queryKey: BACKUP_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/backup")).json(),
    enabled: isAdmin,
    staleTime: 5_000,
  });
  useEffect(() => {
    if (stateQuery.data && !form) setForm(stateQuery.data.settings);
  }, [stateQuery.data, form]);

  const onFailure = (error: unknown) => {
    setNotice(null);
    setActionError(serverErrorText(error));
    void queryClient.invalidateQueries({ queryKey: BACKUP_KEY });
  };
  const saveMutation = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/backup/settings", {
      settings: form,
      ...(passphrase ? { passphrase } : {}),
    })).json() as Promise<BackupState>,
    onSuccess: (saved) => {
      setActionError(null);
      setNotice("Backup settings saved.");
      setPassphrase("");
      setForm(saved.settings);
      queryClient.setQueryData(BACKUP_KEY, saved);
    },
    onError: onFailure,
  });
  const runMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/backup/run")).json() as Promise<{ file: string; entries: number; status: BackupStatus }>,
    onSuccess: (run) => {
      setActionError(null);
      setNotice(`Backup written: ${run.file} (${run.entries} entries).`);
      queryClient.setQueryData<BackupState>(BACKUP_KEY, (current) => current && { ...current, status: run.status });
    },
    onError: onFailure,
  });
  const testMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/backup/restore-test")).json() as Promise<RestoreTestResult>,
    onSuccess: ({ result, status }) => {
      setActionError(null);
      setNotice(`Restore test ${result.digestsMatch ? "passed" : "FAILED"}: ${result.tables} tables, ${result.rows} rows checked in ${result.file}.`);
      queryClient.setQueryData<BackupState>(BACKUP_KEY, (current) => current && { ...current, status });
    },
    onError: onFailure,
  });
  const restoreMutation = useMutation({
    mutationFn: async () => {
      if (!desktop?.restoreBackup) throw new Error("Packaged backup restore is unavailable in this LiOS session.");
      return desktop.restoreBackup(restorePassphrase || undefined);
    },
    onSuccess: (result) => {
      setActionError(null);
      setRestorePassphrase("");
      setNotice(result.cancelled ? "Restore cancelled." : "Restoring backup and restarting LiOS…");
    },
    onError: (error) => {
      setNotice(null);
      setRestorePassphrase("");
      setActionError(stripIpcErrorPrefix(error instanceof Error ? error.message : String(error)));
    },
  });

  if (!isAdmin) return null;
  const state = stateQuery.data;
  if (!state || !form) {
    return (
      <section className="border border-border/60 bg-black/20 p-3" data-testid="connection-backup-settings">
        <p className="font-terminal text-[8px] text-muted-foreground" role={stateQuery.isError ? "alert" : "status"}>
          {stateQuery.isError ? "Backup status is unavailable." : "Checking backups…"}
        </p>
      </section>
    );
  }

  const { status } = state;
  const health = describeBackupHealth(status, state.settings.enabled ? state.settings.intervalHours : 0);
  const dirty = JSON.stringify(form) !== JSON.stringify(state.settings) || passphrase.length > 0;
  const passphraseNeeded = form.encrypt && !status.passphraseSet && passphrase.length === 0;
  const passphraseTooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE_LENGTH;
  const busy = saveMutation.isPending || runMutation.isPending || testMutation.isPending || restoreMutation.isPending || status.running;
  const canSave = dirty && !busy && !passphraseNeeded && !passphraseTooShort && Boolean(form.destination?.trim());
  const update = (patch: Partial<BackupSettingsValues>) => { setNotice(null); setForm({ ...form, ...patch }); };
  const lastSuccess = status.lastSuccessAt ? `Last successful backup: ${formatTime(status.lastSuccessAt)}` : "No successful backup yet";
  const inputClass = "w-full border border-border bg-black/40 px-2 py-1 font-terminal text-[8px] text-foreground";
  const buttonClass = "border border-border px-3 py-1 font-terminal text-[8px] uppercase tracking-wider text-foreground hover:border-[hsl(38,95%,50%)/40%] disabled:opacity-45";

  async function chooseDestination() {
    try {
      const chosen = await desktop?.chooseFolder?.("backup-destination");
      if (chosen) update({ destination: chosen });
    } catch (error) {
      setActionError(stripIpcErrorPrefix(error instanceof Error ? error.message : String(error)));
    }
  }

  return (
    <section className="border border-border/60 bg-black/20 p-3 space-y-3" data-testid="connection-backup-settings">
      <div className="flex items-center gap-2">
        <DatabaseBackup className="h-3.5 w-3.5 text-[hsl(38,95%,55%)]" />
        <h3 className="font-terminal text-[8px] uppercase tracking-widest text-foreground">Backups</h3>
      </div>

      {health === "failed" ? (
        <div className="border border-red-500 bg-red-950/50 p-3" role="alert" data-testid="backup-health-failed">
          <p className="font-ui text-sm font-semibold text-red-300">The last backup failed</p>
          <p className="mt-1 break-words font-ui text-xs text-red-200">{status.lastError}</p>
          <p className="mt-1 font-ui text-xs text-red-200">{lastSuccess}</p>
        </div>
      ) : (
        <p className={`font-terminal text-[8px] ${health === "ok" ? "text-emerald-300" : "text-amber-300"}`} role="status" data-testid={`backup-health-${health}`}>
          {lastSuccess}
          {health === "stale" && " — older than twice your backup interval."}
        </p>
      )}
      {status.lastRestoreTest && (
        <p className={`font-terminal text-[8px] ${status.lastRestoreTest.ok ? "text-muted-foreground" : "text-red-300"}`}>
          Last restore test ({formatTime(status.lastRestoreTest.at)}): {status.lastRestoreTest.ok ? "passed" : "failed"} — {status.lastRestoreTest.message}
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor="backup-destination" className="block font-terminal text-[8px] text-muted-foreground">Backup folder</label>
        <div className="flex gap-2">
          <input id="backup-destination" className={inputClass} value={form.destination ?? ""} placeholder="/path/to/backup/folder"
            onChange={(event) => update({ destination: event.target.value || null })} />
          {desktop?.chooseFolder && (
            <button type="button" className={`${buttonClass} shrink-0`} onClick={() => void chooseDestination()}>Choose folder</button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 font-terminal text-[8px] text-foreground">
          <input type="checkbox" checked={form.encrypt} onChange={(event) => update({ encrypt: event.target.checked })} />
          Encrypt backups
        </label>
        {form.encrypt ? (
          <div className="space-y-1">
            <label htmlFor="backup-passphrase" className="block font-terminal text-[8px] text-muted-foreground">
              Passphrase{status.passphraseSet ? " — Passphrase set (enter a new one to replace it)" : ` (at least ${MIN_PASSPHRASE_LENGTH} characters)`}
            </label>
            <input id="backup-passphrase" type="password" autoComplete="new-password" className={inputClass}
              value={passphrase} onChange={(event) => { setNotice(null); setPassphrase(event.target.value); }} />
            {passphraseTooShort && <p className="font-terminal text-[8px] text-rose-300">Use at least {MIN_PASSPHRASE_LENGTH} characters.</p>}
            <p className="font-terminal text-[7px] text-muted-foreground">
              Keep this passphrase somewhere other than this computer; without it an encrypted backup cannot be opened.
              Encrypted backups are the portable Home-migration format: saved credentials are sealed for re-key under the destination machine's secret custody.
            </p>
          </div>
        ) : (
          <p className="font-terminal text-[8px] text-amber-300">
            An unencrypted backup excludes the vault and storage keys, so saved credentials are not included.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 font-terminal text-[8px] text-foreground">
        <label className="flex items-center gap-2">
          Schedule
          <select className={inputClass + " w-auto"} value={form.enabled ? "every" : "off"} onChange={(event) => update({ enabled: event.target.value === "every" })}>
            <option value="off">Off</option>
            <option value="every">Every N hours</option>
          </select>
        </label>
        {form.enabled && (
          <label className="flex items-center gap-2">
            Hours
            <input type="number" min={1} className={inputClass + " w-16"} value={form.intervalHours}
              onChange={(event) => update({ intervalHours: Math.max(1, Math.floor(Number(event.target.value)) || 1) })} />
          </label>
        )}
        <label className="flex items-center gap-2">
          Keep last
          <input type="number" min={1} className={inputClass + " w-16"} value={form.keep}
            onChange={(event) => update({ keep: Math.max(1, Math.floor(Number(event.target.value)) || 1) })} />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={!canSave} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? "Saving…" : "Save backup settings"}
        </button>
        <button type="button" className={buttonClass} disabled={busy || dirty || !state.settings.destination} onClick={() => runMutation.mutate()}>
          {runMutation.isPending || status.running ? "Backing up…" : "Back up now"}
        </button>
        <button type="button" className={buttonClass} disabled={busy || dirty || !status.lastFile} onClick={() => testMutation.mutate()}>
          {testMutation.isPending ? "Testing…" : "Test restore"}
        </button>
      </div>
      {dirty && <p className="font-terminal text-[7px] text-muted-foreground">Save your changes before backing up or testing a restore.</p>}
      {notice && <p className="font-terminal text-[8px] text-emerald-300" role="status">{notice}</p>}
      {actionError && <p className="font-terminal text-[8px] text-rose-300" role="alert">{actionError}</p>}

      {desktop?.restoreBackup && (
        <div className="space-y-2 border-t border-border/60 pt-3" data-testid="backup-restore-packaged">
          <div>
            <p className="font-terminal text-[8px] text-foreground">Restore a backup</p>
            <p className="mt-1 font-terminal text-[7px] text-muted-foreground">
              LiOS will let you choose a verified backup, stop this Home, restore it, and restart automatically.
              The desktop will ask for final confirmation before anything is changed.
            </p>
          </div>
          <label htmlFor="backup-restore-passphrase" className="block font-terminal text-[8px] text-muted-foreground">
            Restore passphrase — required for encrypted backups; leave blank for unencrypted backups
          </label>
          <input
            id="backup-restore-passphrase"
            type="password"
            autoComplete="off"
            maxLength={512}
            className={inputClass}
            value={restorePassphrase}
            onChange={(event) => {
              setNotice(null);
              setRestorePassphrase(event.target.value);
            }}
          />
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => restoreMutation.mutate()}
            data-testid="restore-backup-button"
          >
            {restoreMutation.isPending ? "Preparing restore…" : "Choose backup and restore…"}
          </button>
        </div>
      )}
    </section>
  );
}
