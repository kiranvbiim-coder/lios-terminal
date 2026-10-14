import assert from "node:assert/strict";
import test from "node:test";
import { ProviderRuntimeHub } from "./providerRuntimeHub";
test("P5 provider runtime hub deduplicates concurrent provider fetches", async () => {
  const hub = new ProviderRuntimeHub<number>();
  let calls = 0;
  const fetcher = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return 42; };
  const [a, b] = await Promise.all([hub.getOrFetch("x", 1_000, fetcher), hub.getOrFetch("x", 1_000, fetcher)]);
  assert.equal(a, 42);
  assert.equal(b, 42);
  assert.equal(calls, 1);
});
test("P5 provider runtime hub publishes replaceable stream events", () => {
  const hub = new ProviderRuntimeHub<number>();
  const values: number[] = [];
  const off = hub.subscribe("prices:AAPL", (value) => values.push(value));
  hub.publish("prices:AAPL", 1);
  off();
  hub.publish("prices:AAPL", 2);
  assert.deepEqual(values, [1]);
});
