import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.resolve(cwd, "package.json"), "utf8")) as { dependencies?: Record<string,string> };
const lock = JSON.parse(fs.readFileSync(path.resolve(cwd, "package-lock.json"), "utf8")) as { packages?: Record<string,unknown> };
const regression = JSON.parse(fs.readFileSync(path.resolve(cwd, "../third_party/imported-oss-regression.json"), "utf8")) as { entries?: Array<{ componentId:string; destinationPaths?:string[]; regressionEvidence?:string[] }> };

const errors:string[]=[];
const direct = new Set(Object.keys(pkg.dependencies ?? {}));
const installed = new Set(Object.keys(lock.packages ?? {}).filter((key) => key.startsWith("node_modules/")).map((key) => key.slice("node_modules/".length)));

for (const forbidden of ["react-resizable-panels","flexlayout-react","flexlayout","dockview-enterprise","openlineage"]) {
  if (direct.has(forbidden) || installed.has(forbidden)) errors.push("Redundant/unapproved runtime package is present: " + forbidden);
}
for (const name of installed) {
  if (name.startsWith("@opentelemetry/")) errors.push("OpenTelemetry runtime package is installed even though P10 uses a LiOS-owned OTLP protocol adapter: " + name);
}
if (pkg.dependencies?.["dockview-react"] !== "8.3.1") errors.push("Dockview production dependency must remain exactly pinned to 8.3.1.");

for (const entry of regression.entries ?? []) {
  for (const relative of [...(entry.destinationPaths ?? []), ...(entry.regressionEvidence ?? [])]) {
    if (!fs.existsSync(path.resolve(cwd, relative))) errors.push(`P10 OSS footprint references missing path ${entry.componentId}: ${relative}`);
  }
}

const p10SourceFiles = [
  "server/p10RuntimePacks.ts",
  "server/p10Observability.ts",
  "server/p10OpenLineage.ts",
  "script/audit_p10_release.ts",
  "script/validate_p10_release_acceptance.ts",
  "script/validate_p10_packaged_acceptance.ts",
  "script/lios_doctor.ts",
];
let sourceBytes=0;
for(const file of p10SourceFiles){
  const resolved=path.resolve(cwd,file);
  if(!fs.existsSync(resolved)) errors.push("P10 source footprint file missing: "+file);
  else sourceBytes+=fs.statSync(resolved).size;
}
const maxSourceBytes=300_000;
if(sourceBytes>maxSourceBytes) errors.push(`P10 hardening source footprint ${sourceBytes} bytes exceeds ${maxSourceBytes} byte review budget.`);

if(errors.length){
  console.error("P10 OSS/resource footprint validation failed:\n- "+errors.join("\n- "));
  process.exitCode=1;
}else{
  console.log(JSON.stringify({
    contractVersion:"1.0.0",
    directProductionDependencies:direct.size,
    installedLockedPackages:installed.size,
    p10HardeningSourceBytes:sourceBytes,
    p10HardeningSourceBudgetBytes:maxSourceBytes,
    redundantWorkspaceRuntimeRemoved:true,
    bundledOpenTelemetryRuntime:false,
    bundledOpenLineageRuntime:false
  },null,2));
}
