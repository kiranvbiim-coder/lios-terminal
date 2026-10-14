import test from "node:test";
import assert from "node:assert/strict";

import { buildOptionsFormulaNotebook } from "./optionsFormulaNotebook";
import { buildOptionCalculationAudit } from "./optionsModels";

const S = 316.22;
const K = 320;
const T = 30 / 365;
const R = 0.05;
const Q = 0.0034;
const VOL = 0.30;

test("formula notebook exposes BSM d1/d2, substituted price and analytical Greek units", () => {
  const audit = buildOptionCalculationAudit({
    spot: S,
    strike: K,
    timeYears: T,
    rate: R,
    dividendYield: Q,
    volatility: VOL,
    isCall: true,
    exerciseStyle: "european",
    volatilitySource: "market_iv",
    rateSource: "USD Treasury curve",
    rateAsOf: "2026-09-09",
  });

  const notebook = buildOptionsFormulaNotebook(audit);
  assert.equal(notebook.model, "Black-Scholes-Merton");
  assert.equal(notebook.sections[0]?.id, "bsm-core");
  assert.equal(notebook.sections[1]?.id, "analytical-greeks");

  const d1 = notebook.sections[0]?.lines.find((line) => line.id === "d1");
  const d2 = notebook.sections[0]?.lines.find((line) => line.id === "d2");
  const price = notebook.sections[0]?.lines.find((line) => line.id === "price");
  const vega = notebook.sections[1]?.lines.find((line) => line.id === "vega");
  const rho = notebook.sections[1]?.lines.find((line) => line.id === "rho");

  assert.match(d1?.symbolic ?? "", /ln\(S\*\/K\)/);
  assert.match(d1?.substitution ?? "", /316\.220000/);
  assert.match(d2?.symbolic ?? "", /d₁/);
  assert.match(price?.symbolic ?? "", /N\(d₁\)/);
  assert.equal(price?.result, audit.output.price.toFixed(8));
  assert.match(vega?.symbolic ?? "", /\/ 100/);
  assert.match(rho?.symbolic ?? "", /\/ 100/);
  assert.equal(notebook.checks.find((check) => check.label === "Price within bounds")?.passed, true);
});

test("formula notebook switches to same-engine finite differences for discrete cash dividends", () => {
  const audit = buildOptionCalculationAudit({
    spot: S,
    strike: K,
    timeYears: T,
    rate: R,
    dividendYield: 0,
    volatility: VOL,
    isCall: false,
    exerciseStyle: "european",
    discreteDividends: [{ amount: 0.25, timeYears: 15 / 365, source: "declared dividend" }],
    volatilitySource: "market_iv",
    rateSource: "USD Treasury curve",
  });

  const notebook = buildOptionsFormulaNotebook(audit);
  assert.equal(notebook.sections[1]?.id, "finite-difference-greeks");
  assert.match(notebook.sections[0]?.lines[0]?.symbolic ?? "", /PV\(cash dividends/);
  assert.ok(notebook.warnings.some((warning) => warning.includes("finite-difference")));
});

test("formula notebook exposes CRR lattice mechanics and American parity caveat", () => {
  const audit = buildOptionCalculationAudit({
    spot: S,
    strike: K,
    timeYears: T,
    rate: R,
    dividendYield: Q,
    volatility: VOL,
    isCall: false,
    exerciseStyle: "american",
    treeSteps: 250,
    volatilitySource: "custom",
    rateSource: "Manual USD rate",
  });

  const notebook = buildOptionsFormulaNotebook(audit);
  assert.match(notebook.model, /Cox-Ross-Rubinstein/);
  assert.equal(notebook.sections[0]?.id, "crr-tree");
  assert.equal(notebook.sections[1]?.id, "finite-difference-greeks");

  const backward = notebook.sections[0]?.lines.find((line) => line.id === "backward");
  assert.match(backward?.symbolic ?? "", /max\(intrinsic/);
  assert.ok(notebook.warnings.some((warning) => warning.includes("put-call parity")));
  assert.equal(notebook.checks.find((check) => check.label === "Put-call parity residual")?.value, "N/A · American exercise");
});
