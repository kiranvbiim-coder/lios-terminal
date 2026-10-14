import test from "node:test";
import assert from "node:assert/strict";
import { getServerListenOptions } from "./listenConfig";

test("server listen options bind to 127.0.0.1 without reusePort", () => {
  assert.deepEqual(getServerListenOptions(5000), {
    port: 5000,
    host: "127.0.0.1",
  });
});
