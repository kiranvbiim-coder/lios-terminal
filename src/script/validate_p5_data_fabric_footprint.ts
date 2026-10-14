import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
const lock=fs.readFileSync(path.join(root,"package-lock.json"),"utf8");
const benchmark=JSON.parse(fs.readFileSync(path.join(root,"..","third_party","p5-data-fabric-benchmark.json"),"utf8"));
const registry=JSON.parse(fs.readFileSync(path.join(root,"..","third_party","components.json"),"utf8"));

for(const name of ["playwright","@modelcontextprotocol/sdk","apache-arrow","@apache-arrow/es2015-cjs","nodejs-polars","polars"]){
  assert.equal(pkg.dependencies?.[name],undefined,`${name} must remain outside P5 Core until the runtime-pack benchmark justifies it.`);
  assert.equal(pkg.optionalDependencies?.[name],undefined,`${name} must not silently enter optionalDependencies.`);
  assert.equal(lock.includes(`"node_modules/${name}"`),false,`${name} unexpectedly entered package-lock.json.`);
}
assert.ok(pkg.dependencies?.["@duckdb/node-api"],"P5 requires the existing DuckDB Node runtime.");
for(const id of ["arrow","polars"]){
  const component=registry.components.find((row:any)=>row.id===id);
  assert.ok(component,`P5 runtime candidate missing from OSS registry: ${id}`);
  assert.equal(component.bundled,false,`${id} must remain non-bundled in P5 Core.`);
}
assert.equal(benchmark.universe.scaleProofCandidates,120000);
assert.equal(benchmark.universe.warmSearchP95TargetMs,300);
assert.equal(benchmark.universe.realCoverageMustBeReportedSeparately,true);
assert.equal(benchmark.providerExecution.cacheGapsOrErrors,false);
assert.equal(benchmark.baseDesktop.playwrightBundled,false);
console.log("P5 Universal Data Fabric footprint/scale policy: PASS");
