import test from "node:test";
import assert from "node:assert/strict";
import {
  QUANT_MODEL_FAMILIES,
  QUANT_MODELS,
  getQuantModel,
  matchQuantModelCommand,
  modelsForQuantFamily,
} from "./quantModelCatalog";

test("quant model catalog preserves all 18 legacy modes exactly once", () => {
  assert.equal(QUANT_MODELS.length, 18);
  assert.equal(new Set(QUANT_MODELS.map((model) => model.key)).size, 18);
  const familyKeys = QUANT_MODEL_FAMILIES.flatMap((family) => family.modelKeys);
  assert.equal(familyKeys.length, 18);
  assert.equal(new Set(familyKeys).size, 18);
  assert.deepEqual(new Set(familyKeys), new Set(QUANT_MODELS.map((model) => model.key)));
});

test("every quant model has a family, command alias, input contract and diagnostic contract", () => {
  for (const model of QUANT_MODELS) {
    assert.ok(model.commandAliases.length > 0, `${model.key} needs a command alias`);
    assert.ok(model.inputHint.length > 0, `${model.key} needs an input contract`);
    assert.ok(model.diagnosticHint.length > 0, `${model.key} needs a diagnostic contract`);
    assert.ok(modelsForQuantFamily(model.family).some((item) => item.key === model.key));
    assert.equal(getQuantModel(model.key).key, model.key);
  }
});

test("terminal-native quant commands resolve without executing models", () => {
  assert.equal(matchQuantModelCommand("PCA AAPL MSFT NVDA")?.model.key, "pca");
  assert.deepEqual(matchQuantModelCommand("PCA AAPL MSFT NVDA")?.arguments, ["AAPL", "MSFT", "NVDA"]);
  assert.equal(matchQuantModelCommand("/GARCH SPX")?.model.key, "forecastupgrade");
  assert.equal(matchQuantModelCommand("SABR SPY")?.model.key, "optionsvol");
  assert.equal(matchQuantModelCommand("PAIR KO PEP")?.model.key, "pairs");
  assert.equal(matchQuantModelCommand("not-a-model AAPL"), null);
});

test("command aliases are globally unique", () => {
  const aliases = QUANT_MODELS.flatMap((model) => model.commandAliases.map((alias) => alias.toUpperCase()));
  assert.equal(new Set(aliases).size, aliases.length);
});
