import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { MANAGED_RUNTIME_MANIFEST } from "../server/runtimeManifest";
import { packSpec, resolveSelectedPacks } from "../server/pythonRuntimeManager";

const args = process.argv.slice(2);
const value = (flag: string) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const output = value("--output");
if (!output) throw new Error("Usage: tsx script/qualify_runtime_wheels.ts --output <new-directory> [--packs core,ml] [--python python3.12]");
const platform = `${process.platform}-${process.arch}`;
if (!MANAGED_RUNTIME_MANIFEST.supportedPlatforms.includes(platform)) throw new Error("Run wheel qualification on a supported target host.");
const selected = resolveSelectedPacks(MANAGED_RUNTIME_MANIFEST, (value("--packs") ?? "core").split(","));
const core = MANAGED_RUNTIME_MANIFEST.packs.find(pack => pack.id === "core")!;
const specs = (packs: typeof selected) => [...new Set(packs.flatMap(pack => pack.packages.map(pkg => {
  const spec = packSpec(pkg);
  if (!spec) throw new Error(`Pack ${pack.id} includes a non-wheel runtime component: ${pkg.name}`);
  return spec;
})))];
const request = {
  platform,
  manifestSha256: crypto.createHash("sha256").update(JSON.stringify(MANAGED_RUNTIME_MANIFEST)).digest("hex"),
  packs: selected.sort((a, b) => a.id === "core" ? -1 : b.id === "core" ? 1 : a.id.localeCompare(b.id))
    .map(pack => ({ id: pack.id, specs: specs(pack.id === "core" ? [core] : [core, pack]) })),
};
const result = spawnSync(value("--python") ?? process.env.PYTHON_EXECUTABLE ?? "python3", [
  path.join(path.dirname(fileURLToPath(import.meta.url)), "qualify_runtime_wheels.py"), "--output", path.resolve(output),
], { input: JSON.stringify(request), stdio: ["pipe", "inherit", "inherit"], timeout: 60 * 60 * 1_000 });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Wheel closure qualification failed (${result.status ?? result.signal}); no qualified artifact was published.`);
