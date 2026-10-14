import test from "node:test";
import assert from "node:assert/strict";
import { assertLocalByodRuntime, isHostedProductionRuntime, secureSessionCookieRequired, trustProxySetting } from "./runtimeSecurity";

test("local desktop runtime never inherits hosted proxy or secure-cookie assumptions", () => {
  assert.equal(isHostedProductionRuntime({ NODE_ENV: "production", HOST: "127.0.0.1" }), false);
  assert.equal(trustProxySetting({ NODE_ENV: "production", HOST: "127.0.0.1" }), false);
  assert.equal(secureSessionCookieRequired({ NODE_ENV: "production", HOST: "127.0.0.1" }), false);
});

test("a Home does not trust forged proxy headers until the operator opts into a proxy", () => {
  const env = { NODE_ENV: "production", HOST: "0.0.0.0", DATABASE_URL: "postgresql://db/lios" };
  assert.equal(isHostedProductionRuntime(env), true);
  assert.equal(trustProxySetting(env), false);
  assert.equal(trustProxySetting({ ...env, TRUST_PROXY: "1" }), 1);
  assert.equal(secureSessionCookieRequired(env), true);
});

test("trust proxy never accepts an unbounded boolean shortcut", () => {
  assert.equal(trustProxySetting({ TRUST_PROXY: "2" }), 2);
  assert.equal(trustProxySetting({ TRUST_PROXY: "0" }), false);
  assert.throws(() => trustProxySetting({ TRUST_PROXY: "true" }), /proxy-hop count/i);
  assert.throws(() => trustProxySetting({ TRUST_PROXY: "99" }), /proxy-hop count/i);
});


test("user-owned BYOD execution fails closed on hosted production", () => {
  for (const label of ["Private API BYOD connector", "Cloud storage BYOD connector", "Database BYOD connector"]) {
    assert.throws(
      () => assertLocalByodRuntime(label, { NODE_ENV: "production", HOST: "0.0.0.0", DATABASE_URL: "postgresql://db/lios" }),
      /local-desktop only/i,
    );
  }
  assert.doesNotThrow(() => assertLocalByodRuntime("Private API BYOD connector", { NODE_ENV: "production", HOST: "127.0.0.1" }));
});
