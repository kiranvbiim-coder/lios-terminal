import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getRootTokens,
  contrastRatio,
  findTokenAuthorityProblems,
  validateTokenAuthority,
} from "./validate_ui_token_authority.mjs";

const dir = new URL("../client/src/", import.meta.url);
const source = (name) => fs.readFileSync(new URL(name, dir), "utf8");
const fixture = () => ({ entry: source("terminalStyles.ts"), shell: source("terminal-shell.css") });

test("WS-06 sole imported canonical palette contract passes on this checkout", () => {
  assert.deepEqual(findTokenAuthorityProblems(fixture()), []);
  assert.deepEqual(validateTokenAuthority(), {
    status: "source-contract-pass",
    canonical: "terminal-shell.css",
    independentNativeVisualProof: "NOT_RUN",
  });
});

test("WS-06 rejects an alternate theme after the canonical CSS and any retired theme lock", () => {
  const { entry, shell } = fixture();
  assert.ok(findTokenAuthorityProblems({
    entry: entry + '\nimport "./terminal-theme-lock.css";',
    shell,
  }).some((p) => p.includes("Retired conflicting")));
  assert.ok(findTokenAuthorityProblems({
    entry, shell, legacyFilePresent: true,
  }).some((p) => p.includes("Retired conflicting")));
});

test("WS-06 refuses duplicate shell imports and palette layer reordering", () => {
  const { entry, shell } = fixture();
  const beforeCanvas = entry.replace('import "./terminal-shell.css";', "");
  assert.ok(findTokenAuthorityProblems({ entry: beforeCanvas, shell }).some((p) => p.includes("Exactly one")));
  assert.ok(findTokenAuthorityProblems({
    entry: entry.replace('import "./visual-intelligence-canvas.css";',
      'import "./visual-intelligence-canvas.css";\nimport "./terminal-ux-phase1.css";'), shell,
  }).some((p) => p.includes("last palette layer")));
});

test("WS-06 catches modified graphite, gold and direction semantics", () => {
  const { entry, shell } = fixture();
  const offBrand = shell.replace("--lios-brand: #d4a017;", "--lios-brand: #ff0000;");
  assert.ok(findTokenAuthorityProblems({ entry, shell: offBrand }).some((p) => p.includes("--lios-brand")));
  const offDirection = shell.replace("--up: 201.72 70.73% 51.76%;", "--up: 0 80% 50%;");
  assert.ok(findTokenAuthorityProblems({ entry, shell: offDirection })
    .some((p) => p.includes("--lios-market-up / --up")));
});

test("WS-06 protect readable text contrast and correct scoped token declaration", () => {
  assert.ok(contrastRatio("#ede9e0", "#09090b") >= 4.5);
  assert.ok(contrastRatio("#b5b0ba", "#111115") >= 4.5);
  assert.ok(contrastRatio("#777777", "#777777") < 4.5);
  const { entry, shell } = fixture();
  assert.equal(getRootTokens(shell)["--lios-bg-app"], "#09090b");
  const altered = shell.replace("--lios-text-muted: #a09ca6;", "--lios-text-muted: #181818;");
  assert.ok(findTokenAuthorityProblems({ entry, shell: altered })
    .some((p) => p.includes("lacks 4.5:1 contrast")));
});

test("WS-06 source checks do not misreport rendered/native or screen-reader acceptance", () => {
  assert.equal(validateTokenAuthority().independentNativeVisualProof, "NOT_RUN");
});

test("WS-06 crash recovery consumes canonical tokens rather than inactive amber hardcoding", () => {
  const bootstrap = source("main.tsx");
  const shell = source("terminal-shell.css");
  for (const token of ["--lios-bg-app", "--lios-bg-panel", "--lios-brand"]) {
    assert.ok(bootstrap.includes("var(" + token + ")"), "Crash recovery is disconnected from " + token);
  }
  assert.doesNotMatch(bootstrap, /#[0-9a-f]{6}/i, "Crash fallback must not fork the palette");
  assert.match(shell, /\.lios-root-recovery-action:focus-visible\s*\{\s*outline:\s*2px solid var\(--lios-brand\)/);
  assert.match(shell, /\.lios-root-recovery-action:hover\s*\{\s*background:\s*color-mix\(/);
});
