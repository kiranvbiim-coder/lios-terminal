import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const screen = (name: string) =>
  readFileSync(new URL("../components/terminal/" + name + ".tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../sprint-c-intelligence-visuals.css", import.meta.url), "utf8");
const entry = readFileSync(new URL("../terminalStyles.ts", import.meta.url), "utf8");

test("Sprint C renders recorded financial data with native keyboard-readable table and bounded chart series", () => {
  const ui = screen("FusionMarketCanvas");
  assert.match(ui, /recordedBreadthRows\(series, points\)/);
  assert.match(ui, /recordedLatestBreadth\(latest\)/);
  assert.match(ui, /<details className="fusion-sprint-c-data">/);
  assert.match(ui, /<table aria-label=/);
  assert.match(ui, /<th scope="col">Session<\/th>/);
  assert.match(ui, /<time dateTime=\{row.date\}>/);
  assert.match(ui, /No valid recorded breadth rows/);
  assert.match(ui, /isAnimationActive=\{false\}/);
  assert.match(ui, /MARKET MAP · RECORDED OBSERVATIONS/);
  assert.doesNotMatch(ui, /d3\.transition|Math\.random\(|setInterval\(|fetch\(/);
});

test("Sprint C polish is registered before canonical shell, isolated to existing views and honors low-resource settings", () => {
  const phaseOne = readFileSync(new URL("../terminal-ux-phase1.css", import.meta.url), "utf8");
  assert.match(phaseOne, /^@import "\.\/sprint-c-intelligence-visuals\.css";/);
  assert.ok(entry.indexOf('import "./terminal-ux-phase1.css"') < entry.indexOf('import "./terminal-shell.css"'));
  assert.doesNotMatch(entry, /import "\.\/sprint-c-intelligence-visuals\.css";/);
  assert.match(css, /\[data-sprint-c-visual="market"\]/);
  assert.match(css, /@container lios-market \(max-width: 560px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /data-low-resource-mode="true"/);
  assert.match(css, /data-reduced-motion="true"/);
  assert.doesNotMatch(css, /@import|url\(|@keyframes|filter:\s*blur\(|backdrop-filter/);
  assert.match(screen("GraphExplorer"), /data-sprint-c-visual="graph"/);
  assert.match(screen("ProvenanceDrawer"), /data-sprint-c-visual="evidence"/);
  assert.match(screen("AnalyticalStudio"), /data-sprint-c-visual="studio"/);
});
