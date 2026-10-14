import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const serverRoot = path.resolve(process.cwd(), "server");

test("server startup never pre-warms external market data outside a user request", () => {
  const indexSource = fs.readFileSync(path.join(serverRoot, "index.ts"), "utf8");
  const marketDataSource = fs.readFileSync(path.join(serverRoot, "marketData.ts"), "utf8");

  assert.equal(indexSource.includes("startBackgroundQuoteWarmup"), false);
  assert.equal(marketDataSource.includes("startBackgroundQuoteWarmup"), false);
  assert.equal(marketDataSource.includes("Warming up securities directory quotes cache"), false);
});
