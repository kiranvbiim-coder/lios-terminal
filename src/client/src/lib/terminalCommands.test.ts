import test from "node:test";
import assert from "node:assert/strict";

import { parseTerminalCommand } from "./terminalCommands";

test("parseTerminalCommand treats a bare ticker as a quote command", () => {
  assert.deepEqual(parseTerminalCommand("aapl"), {
    raw: "AAPL",
    symbol: "AAPL",
    view: "quote",
  });
});

test("parseTerminalCommand maps Bloomberg-style function aliases", () => {
  assert.deepEqual(parseTerminalCommand("AAPL GP"), {
    raw: "AAPL GP",
    symbol: "AAPL",
    view: "chart",
  });

  assert.deepEqual(parseTerminalCommand("MSFT DES"), {
    raw: "MSFT DES",
    symbol: "MSFT",
    view: "quote",
  });

  assert.deepEqual(parseTerminalCommand("BTC-USD NEWS"), {
    raw: "BTC-USD NEWS",
    symbol: "BTC-USD",
    view: "news",
  });
});

test("parseTerminalCommand supports standalone navigation aliases", () => {
  assert.deepEqual(parseTerminalCommand("MRKT"), {
    raw: "MRKT",
    view: "market",
  });

  assert.deepEqual(parseTerminalCommand("ECST"), {
    raw: "ECST",
    view: "economics",
  });
});

test("parseTerminalCommand opens the internal quant model registry", () => {
  assert.deepEqual(parseTerminalCommand("modelregistry"), { raw: "MODELREGISTRY", view: "quantregistry" });
  assert.deepEqual(parseTerminalCommand("qreg"), { raw: "QREG", view: "quantregistry" });
  assert.deepEqual(parseTerminalCommand("qlab"), { raw: "QLAB", view: "quantlab" });
  assert.deepEqual(parseTerminalCommand("experiments"), { raw: "EXPERIMENTS", view: "quantlab" });
});

test("parseTerminalCommand opens point-in-time market data for any ticker", () => {
  assert.deepEqual(parseTerminalCommand("AAPL PITDATA"), { raw: "AAPL PITDATA", symbol: "AAPL", view: "marketdatafabric" });
  assert.deepEqual(parseTerminalCommand("marketdata"), { raw: "MARKETDATA", view: "marketdatafabric" });
});

test("parseTerminalCommand opens the macro and rates data fabric", () => {
  assert.deepEqual(parseTerminalCommand("pitmacro"), { raw: "PITMACRO", view: "economicdatafabric" });
  assert.deepEqual(parseTerminalCommand("curvedata"), { raw: "CURVEDATA", view: "economicdatafabric" });
});

test("parseTerminalCommand opens universe, entitlement, and columnar data fabric", () => {
  assert.deepEqual(parseTerminalCommand("universe"), { raw: "UNIVERSE", view: "universefabric" });
  assert.deepEqual(parseTerminalCommand("columnar"), { raw: "COLUMNAR", view: "universefabric" });
});

test("parseTerminalCommand opens the integrated model studio with a symbol", () => {
  assert.deepEqual(parseTerminalCommand("AAPL 3STM"), { raw: "AAPL 3STM", symbol: "AAPL", view: "integratedmodel" });
  assert.deepEqual(parseTerminalCommand("finmodel"), { raw: "FINMODEL", view: "integratedmodel" });
});

test("parseTerminalCommand returns null for empty input", () => {
  assert.equal(parseTerminalCommand("   "), null);
});

test("parseTerminalCommand maps new M&A and FP&A aliases", () => {
  assert.deepEqual(parseTerminalCommand("MNA"), {
    raw: "MNA",
    view: "mnadesk",
  });

  assert.deepEqual(parseTerminalCommand("INTEG"), {
    raw: "INTEG",
    view: "integration",
  });

  assert.deepEqual(parseTerminalCommand("FPA"), {
    raw: "FPA",
    view: "fpa",
  });
});

test("parseTerminalCommand opens readiness and connector registry panels", () => {
  assert.deepEqual(parseTerminalCommand("READY"), {
    raw: "READY",
    view: "enginereadiness",
  });
  assert.deepEqual(parseTerminalCommand("CONNECTORS"), {
    raw: "CONNECTORS",
    view: "connectors",
  });
  assert.deepEqual(parseTerminalCommand("CONFLICTS"), {
    raw: "CONFLICTS",
    view: "conflictdetector",
  });
});
