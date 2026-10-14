import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
const dependencies={...(pkg.dependencies??{}),...(pkg.devDependencies??{}),...(pkg.optionalDependencies??{})};

for(const forbidden of ["monaco-editor","@monaco-editor/react","skfolio","cvxpy","quantconnect-lean","lean","arelle","backtest-kit"]) {
  assert.equal(dependencies[forbidden],undefined,"P6 optional runtime/editor must not become a base Node dependency: "+forbidden);
}

const coreFiles=[
  "server/p6BacktestEngine.ts",
  "server/p6PersonalFinance.ts",
  "server/p6FinanceWorkflow.ts",
  "server/p6RiskFixedDerivatives.ts",
  "server/p6RuntimeRegistry.ts",
  "server/p6FinanceRoutes.ts",
  "shared/p6FinanceContracts.ts",
  "client/src/components/panels/BacktestPanel.tsx",
  "client/src/lib/backtestCockpit.ts",
  "client/src/lib/exportPptx.ts",
];
let total=0;
for(const file of coreFiles){
  const bytes=fs.statSync(path.join(root,file)).size;
  assert.ok(bytes<180_000,"P6 core file exceeds maintainability budget: "+file+" ("+bytes+" bytes).");
  total+=bytes;
}
assert.ok(total<650_000,"P6 convergence layer footprint unexpectedly large: "+total+" bytes.");
console.log("P6 finance footprint: PASS ("+total+" bytes across canonical core files)");
