import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("LiOS canonical shell is the final structural arbiter before the owned Visual Canvas", () => {
  const styles = read("../terminalStyles.ts");
  const shell = read("../terminal-shell.css");
  const normalized = shell.toLowerCase();

  const phaseOneImport = styles.indexOf('import "./terminal-ux-phase1.css";');
  const shellImport = styles.indexOf('import "./terminal-shell.css";');
  const visualCanvasImport = styles.indexOf('import "./visual-intelligence-canvas.css";');

  assert.ok(phaseOneImport >= 0, "Phase 1 component visual system must exist");
  assert.ok(shellImport > phaseOneImport, "Canonical shell must arbitrate feature layers");
  assert.ok(visualCanvasImport > shellImport, "Only the owned Visual Intelligence Canvas loads after the shell");

  for (const token of [
    "--lios-bg-app: #09090b",
    "--lios-bg-shell: #07070a",
    "--lios-bg-panel: #111115",
    "--lios-bg-panel-2: #0d0d10",
    "--lios-bg-elevated: #16161c",
    "--lios-bg-hover: #16161c",
    "--lios-border-subtle: #1f1f28",
    "--lios-border-default: #1f1f28",
    "--lios-brand: #d4a017",
    "--lios-market-up: #2d9cdb",
    "--lios-market-down: #d4511a",
    "--lios-success: #1fcb84",
  ]) {
    assert.ok(normalized.includes(token), `Missing exact shell token: ${token}`);
  }

  assert.match(shell, /\.terminal-root\s*\{[\s\S]*background:\s*var\(--lios-bg-app\)/);
  assert.match(shell, /\.terminal-root::before,[\s\S]*content:\s*none\s*!important/);
  assert.match(shell, /\[data-testid\^='workspace-pane-'\][\s\S]*background:\s*var\(--lios-bg-panel\)\s*!important/);
  assert.match(shell, /aside\[aria-label='LIOS advanced workspace navigation'\][\s\S]*background:\s*var\(--lios-bg-shell\)\s*!important/);
});

test("LiOS canonical shell keeps structural surfaces matte while preserving analytical semantics", () => {
  const shell = read("../terminal-shell.css");

  assert.match(shell, /\.fusion-market-canvas[\s\S]*background:\s*var\(--lios-bg-app\)\s*!important/);
  assert.match(shell, /\.lios-v4-overlay[\s\S]*background:\s*var\(--lios-bg-elevated\)\s*!important/);
  assert.match(shell, /\.text-up[\s\S]*color:\s*var\(--lios-market-up\)\s*!important/);
  assert.match(shell, /\.text-down[\s\S]*color:\s*var\(--lios-market-down\)\s*!important/);
  assert.match(shell, /font-variant-numeric:\s*tabular-nums lining-nums/);
  assert.match(shell, /focus-visible[\s\S]*outline:\s*1px solid var\(--lios-brand\)\s*!important/);
});

test("Contextual Visual Intelligence Canvas is the only authorized environmental background layer", () => {
  const canvas = read("../visual-intelligence-canvas.css");
  assert.match(canvas, /main\[data-visual-host="true"\][\s\S]*background-color:\s*transparent\s*!important/);
  assert.match(canvas, /\.lios-visual-canvas__image[\s\S]*background-image:\s*var\(--lios-visual-environment-image\)/);
  assert.match(canvas, /data-intensity="immersive"/);
  assert.match(canvas, /data-intensity="contextual"/);
  assert.match(canvas, /data-intensity="focus"/);
  assert.doesNotMatch(canvas, /video\s*\{/i);
});

