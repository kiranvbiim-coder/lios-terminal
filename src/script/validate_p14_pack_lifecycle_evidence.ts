import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateP14PackLifecycleObservation,
  type P14PackLifecycleObservation,
} from "../shared/p14PackLifecycleEvidence";

export type P14PackLifecycleEvidenceFileResult = {
  path: string;
  observation: P14PackLifecycleObservation;
};

export function validateP14PackLifecycleEvidenceFile(inputPath: string): P14PackLifecycleEvidenceFileResult {
  const value = typeof inputPath === "string" ? inputPath.trim() : "";
  if (!value) throw new Error("P14 pack lifecycle observation path is required.");
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("P14 pack lifecycle observation file does not exist.");
  }
  let input: unknown;
  try {
    input = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    throw new Error("P14 pack lifecycle observation is not valid JSON.");
  }
  return { path: resolved, observation: validateP14PackLifecycleObservation(input) };
}

function main(argv = process.argv.slice(2)): void {
  const [inputPath, ...extra] = argv;
  if (extra.length) throw new Error("Usage: tsx script/validate_p14_pack_lifecycle_evidence.ts <observation.json>");
  const result = validateP14PackLifecycleEvidenceFile(inputPath ?? "");
  process.stdout.write(
    `P14 pack lifecycle observation: PASS · ${result.observation.platform}-${result.observation.arch} · `
      + `${result.observation.packId} · ${result.observation.baselineVersion} -> ${result.observation.targetVersion} -> ${result.observation.rollbackVersion}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "P14 pack lifecycle observation validation failed.";
    process.stderr.write(`P14 pack lifecycle observation: FAIL · ${message}\n`);
    process.exitCode = 1;
  }
}
