import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateP14WorkspaceRestoreObservation,
  type P14WorkspaceRestoreObservation,
} from "../shared/p14WorkspaceRestoreEvidence";

export type P14WorkspaceRestoreEvidenceFileResult = {
  path: string;
  observation: P14WorkspaceRestoreObservation;
};

export function validateP14WorkspaceRestoreEvidenceFile(inputPath: string): P14WorkspaceRestoreEvidenceFileResult {
  const value = typeof inputPath === "string" ? inputPath.trim() : "";
  if (!value) throw new Error("P14 workspace restore observation path is required.");
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("P14 workspace restore observation file does not exist.");
  }
  let input: unknown;
  try {
    input = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    throw new Error("P14 workspace restore observation is not valid JSON.");
  }
  return { path: resolved, observation: validateP14WorkspaceRestoreObservation(input) };
}

function main(argv = process.argv.slice(2)): void {
  const [inputPath, ...extra] = argv;
  if (extra.length) throw new Error("Usage: tsx script/validate_p14_workspace_restore_evidence.ts <observation.json>");
  const result = validateP14WorkspaceRestoreEvidenceFile(inputPath ?? "");
  process.stdout.write(
    `P14 workspace restore observation: PASS · ${result.observation.platform}-${result.observation.arch} · `
      + `${result.observation.backupFormat} · ${result.observation.rowsRestored} rows · ${result.observation.filesRestored} files\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "P14 workspace restore observation validation failed.";
    process.stderr.write(`P14 workspace restore observation: FAIL · ${message}\n`);
    process.exitCode = 1;
  }
}
