import assert from "node:assert/strict";
import test from "node:test";
import { ADVANCED_RATES_DERIVATIVES, manualAdvancedRequest, parseAdvancedManualParameters, validateAdvancedManualParameters } from "./advancedRatesDerivatives";

test("advanced rates and derivatives manual catalog covers the assigned endpoints", () => {
  assert.equal(Object.keys(ADVANCED_RATES_DERIVATIVES).length, 18);
  assert.ok("derivatives/exotic-monte-carlo" in ADVANCED_RATES_DERIVATIVES);
  assert.ok("fixed-income/bootstrap-par-curve" in ADVANCED_RATES_DERIVATIVES);
});

test("manual conversion preserves the exact engine parameters in provenance", () => {
  const parameters = { spot: 100, strike: 105, seed: 7 };
  const request = manualAdvancedRequest(parameters);
  assert.deepEqual(request, {
    ...parameters,
    inputProvenance: { dataClassification: "manual", manualInputs: parameters },
  });
});

test("editable parameter JSON cannot replace generated provenance", () => {
  assert.throws(() => parseAdvancedManualParameters('{"inputProvenance":{"dataClassification":"live"}}'), /Do not add inputProvenance/);
  assert.throws(() => parseAdvancedManualParameters("[]"), /Parameters must be a JSON object/);
});

test("manual validation rejects incomplete or non-finite engine inputs before transport", () => {
  assert.throws(
    () => validateAdvancedManualParameters("derivatives/black-scholes-greeks", { spot: 100 }),
    /Missing required manual field: strike/,
  );
  assert.throws(
    () => validateAdvancedManualParameters("derivatives/black-scholes-greeks", { ...ADVANCED_RATES_DERIVATIVES["derivatives/black-scholes-greeks"].parameters, spot: Number.NaN }),
    /parameters.spot must be a finite number/,
  );
});
