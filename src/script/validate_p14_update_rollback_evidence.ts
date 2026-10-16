import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateP14UpdateRollbackObservation,
  type P14UpdateRollbackObservation,
} from "../shared/p14UpdateRollbackEvidence";

export type P14UpdateRollbackEvidenceFileResult = {
  path: string;
  observation: P14UpdateRollbackObservation;
};

export function validateP14UpdateRollbackEvidenceFile(inputPath: string): P14UpdateRollbackEvidenceFileResult {
  const value = typeof inputPath === "string" ? inputPath.trim() : "";
  if (!value) throw new Error("P14 update/rollback observation path is required.");

  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("P14 update/rollback observation file does not exist.");
  }

  let input: unknown;
  try {
    input = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    throw new Error("P14 update/rollback observation is not valid JSON.");
  }

  return {
    path: resolved,
    observation: validateP14UpdateRollbackObservation(input),
  };
}

function main(argv = process.argv.slice(2)): void {
  const [inputPath, ...extra] = argv;
  if (extra.length) throw new Error("Usage: tsx script/validate_p14_update_rollback_evidence.ts <observation.json>");
  const result = validateP14UpdateRollbackEvidenceFile(inputPath ?? "");
  process.stdout.write(
    `P14 update/rollback observation: PASS · ${result.observation.platform}-${result.observation.arch} · `
      + `${result.observation.baselineVersion} -> ${result.observation.targetVersion} · `
      + `${result.observation.recoveryOutcome}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "P14 update/rollback observation validation failed.";
    process.stderr.write(`P14 update/rollback observation: FAIL · ${message}\n`);
    process.exitCode = 1;
  }
}
