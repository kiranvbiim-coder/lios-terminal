import assert from "node:assert/strict";
import test from "node:test";
import { assertStrictNumericalPackInventory, STRICT_NUMERICAL_PACKS } from "./strictPythonRuntimeInventory";

const good = () => ({ numpy: "2.5.3", scipy: "1.18.1", pydantic: "2.13.5", QuantLib: "unavailable" });

test("strict worker inventory must list all required numerical packs, independent of optional engines", () => {
  assert.deepEqual(STRICT_NUMERICAL_PACKS, ["numpy", "scipy", "pydantic"]);
  assert.doesNotThrow(() => assertStrictNumericalPackInventory(good()));
  assert.doesNotThrow(() => assertStrictNumericalPackInventory(Object.assign(Object.create(null), good())));
});

test("strict health fails closed for any missing, unavailable or empty required pack", () => {
  for (const name of STRICT_NUMERICAL_PACKS) {
    for (const value of [undefined, "unavailable", "UNAVAILABLE", "unknown", "", "  "]) {
      const inventory: Record<string, string> = { ...good() };
      if (value === undefined) delete inventory[name];
      else inventory[name] = value;
      assert.throws(
        () => assertStrictNumericalPackInventory(inventory),
        (error: unknown) => error instanceof Error &&
          error.message.includes(`required ${name} package`) &&
          error.message.includes("no host fallback"),
        `${name}=${String(value)} must not cause a ready state`,
      );
    }
  }
});

test("inherited properties and unrelated optional package failures cannot counterfeit readiness", () => {
  const spoofed = Object.create({ numpy: "2.5.3" }) as Record<string, string>;
  spoofed.scipy = "1.18.1";
  spoofed.pydantic = "2.13.5";
  assert.throws(() => assertStrictNumericalPackInventory(spoofed), /required numpy package/);
  assert.doesNotThrow(() => assertStrictNumericalPackInventory({
    ...good(), QuantLib: "unavailable", "scikit-learn": "unavailable",
  }));
});
