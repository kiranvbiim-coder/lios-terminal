import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { auditP10Release } from "./audit_p10_release";

test("P10 source governance reconciles OSS and rights while withheld release qualification remains NOT_RUN", () => {
  const result = auditP10Release(path.resolve(process.cwd(), ".."));
  assert.deepEqual(result.errors, []);
  assert.ok(result.regressionEntries >= 6);
  assert.equal(result.lseComponents, 3);
  assert.deepEqual(result.qualification, {
    binaryRelease: "NOT_RUN",
    signedInstallers: "NOT_RUN",
    packagedShippingPoints: "NOT_RUN",
    nativeHardware: "NOT_RUN",
    realDatasetBenchmark: "NOT_RUN",
  });
  assert.match(result.warnings.join("\n"), /NOT_RUN/);
});
