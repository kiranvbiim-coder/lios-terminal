import assert from "node:assert/strict";
import test from "node:test";
import { isLocalRuntime } from "./auth";
import { resolveRuntimeMode } from "./runtimeMode";

const cases: Array<[string | undefined, "desktop_local" | "user_home_server"]> = [
  [undefined, "desktop_local"], ["", "desktop_local"], ["  ", "desktop_local"],
  ["127.0.0.1", "desktop_local"], ["localhost", "desktop_local"], ["::1", "desktop_local"], [" 127.0.0.1 ", "desktop_local"],
  ["0.0.0.0", "user_home_server"], ["192.168.1.20", "user_home_server"], ["nas.local", "user_home_server"], ["::", "user_home_server"],
];

test("HOST decides the runtime mode; unset or loopback is Desktop Local", () => {
  for (const [host, mode] of cases) {
    assert.equal(resolveRuntimeMode(host === undefined ? {} : { HOST: host }), mode, `HOST=${JSON.stringify(host)}`);
  }
});

test("auth isLocalRuntime keeps its previous meaning by delegating to the mode resolver", () => {
  for (const [host, mode] of cases) {
    assert.equal(isLocalRuntime(host === undefined ? {} : { HOST: host }), mode === "desktop_local", `HOST=${JSON.stringify(host)}`);
  }
});

test("the database choice does not change the mode", () => {
  assert.equal(resolveRuntimeMode({ DATABASE_URL: "postgres://user:pw@db.example/lios" }), "desktop_local");
});
