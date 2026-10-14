import test from "node:test";
import assert from "node:assert/strict";
import { validateDatabaseResultIdentity } from "./sourceConnectionRoutes";

test("accepts database rows whose identity column matches requested symbol", () => {
  assert.doesNotThrow(() => validateDatabaseResultIdentity(
    [{ ticker: "AAPL", revenue: 100 }, { ticker: "aapl", revenue: 120 }],
    "AAPL",
    "ticker",
  ));
});

test("rejects database rows missing identity or belonging to another issuer", () => {
  assert.throws(
    () => validateDatabaseResultIdentity([{ revenue: 100 }], "AAPL", "ticker"),
    /requires every result row to include identity column/,
  );
  assert.throws(
    () => validateDatabaseResultIdentity([{ ticker: "MSFT", revenue: 100 }], "AAPL", "ticker"),
    /different issuer/,
  );
});
