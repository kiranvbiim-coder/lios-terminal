import type { Express } from "express";
import { z } from "zod";
import { requireHomeOwner } from "./auth";
import {
  BackupConfigurationError,
  readBackupSettings,
  readBackupStatus,
  restoreTestLatest,
  runBackupNow,
  saveBackupSettings,
} from "./backupService";
import { BackupError } from "./backupArchive";

/** Owner-only (Home administrators). Registered before the internal gate so a customer terminal's admin can use it too. */
export function registerBackupRoutes(app: Express): void {

  app.get("/api/backup", requireHomeOwner, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ settings: readBackupSettings(), status: readBackupStatus() });
  });

  app.put("/api/backup/settings", requireHomeOwner, (req, res) => {
    const parsed = z.object({ settings: z.unknown(), passphrase: z.string().max(512).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Provide backup settings." });
    try {
      saveBackupSettings(parsed.data.settings, parsed.data.passphrase);
      return res.json({ settings: readBackupSettings(), status: readBackupStatus() });
    } catch (error) {
      if (error instanceof BackupConfigurationError) return res.status(400).json({ error: error.message });
      if (error instanceof z.ZodError) return res.status(400).json({ error: "The backup settings are not valid." });
      throw error;
    }
  });

  app.post("/api/backup/run", requireHomeOwner, async (_req, res, next) => {
    try {
      const result = await runBackupNow();
      res.json({ file: result.file, entries: result.manifest.entries.length, status: readBackupStatus() });
    } catch (error) {
      if (error instanceof BackupConfigurationError || error instanceof BackupError) return res.status(400).json({ error: error.message, status: readBackupStatus() });
      next(error);
    }
  });

  app.post("/api/backup/restore-test", requireHomeOwner, async (_req, res, next) => {
    try {
      res.json({ result: await restoreTestLatest(), status: readBackupStatus() });
    } catch (error) {
      if (error instanceof BackupConfigurationError || error instanceof BackupError) return res.status(400).json({ error: error.message, status: readBackupStatus() });
      next(error);
    }
  });
}
