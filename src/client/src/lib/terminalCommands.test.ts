import test from "node:test";
import assert from "node:assert/strict";

import { dispatchCanonicalNavigation, parseTerminalCommand, resolveWorkSearchLibraryTarget, searchCanonicalNavigation } from "./terminalCommands";
import { parseFlexibleTerminalCommand } from "./terminalIntentCommands";

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
    view: "missioncontrol",
    navigation: "connections",
  });
  assert.deepEqual(parseTerminalCommand("CONFLICTS"), {
    raw: "CONFLICTS",
    view: "conflictdetector",
  });
});

test("reserved application destinations dispatch to canonical surfaces without ticker or execution actions", () => {
  const opened: string[] = [];
  const selection = { projectId: 42, chatId: 73, draft: "Unsent work" };
  for (const [query, expected] of [
    ["automations", "automations"], ["open library", "library"], ["saved artifacts", "library"],
    ["history", "chats"], ["go to projects", "projects"], ["Connections & AI", "connections"],
    ["AI", "connections"], ["LiOS doctor", "connections"], ["conversation", "conversation"],
  ]) {
    const command = parseFlexibleTerminalCommand(query);
    assert.ok(command?.navigation, query);
    assert.equal(command.symbol, undefined, "Navigation must never manufacture a ticker");
    dispatchCanonicalNavigation(command.navigation, {
      openConnections: () => opened.push("connections"),
      openProjectSection: (section) => opened.push(section),
    });
    assert.equal(opened.at(-1), expected, query);
  }
  assert.deepEqual(selection, { projectId: 42, chatId: 73, draft: "Unsent work" });
});

test("navigation metadata searches supported destinations without suggesting runnable tools", () => {
  assert.equal(searchCanonicalNavigation("automations")[0]?.target, "automations");
  assert.equal(searchCanonicalNavigation("saved artifacts")[0]?.target, "library");
  assert.equal(searchCanonicalNavigation("connections")[0]?.target, "connections");
  assert.match(searchCanonicalNavigation("doctor")[0]?.description ?? "", /Does not.*run a repair/);
  assert.deepEqual(searchCanonicalNavigation("unregistered destination"), []);
});

test("explicit ticker lookup remains available for reserved navigation words", () => {
  assert.deepEqual(parseFlexibleTerminalCommand("QUOTE AUTOMATIONS"), {
    raw: "QUOTE AUTOMATIONS", symbol: "AUTOMATIONS", view: "quote",
  });
  assert.deepEqual(parseFlexibleTerminalCommand("AI QUOTE"), {
    raw: "AI QUOTE", symbol: "AI", view: "quote",
  });
  assert.deepEqual(parseFlexibleTerminalCommand("AAPL"), { raw: "AAPL", symbol: "AAPL", view: "quote" });
  assert.deepEqual(parseFlexibleTerminalCommand("DCF NVDA"), { raw: "DCF NVDA", symbol: "NVDA", view: "valuation" });
});

test("work search navigation retains exact object identity and refuses incomplete matches", () => {
  const result = { kind: "artifact" as const, id: "search-row", title: "Same title", snippet: null, projectId: 42, chatId: null, artifactId: "artifact-exact", resourceId: "wrong-file", updatedAt: "2026-10-17" };
  assert.deepEqual(resolveWorkSearchLibraryTarget(result), { projectId: 42, artifactId: "artifact-exact", resourceId: null });
  assert.deepEqual(resolveWorkSearchLibraryTarget({ ...result, kind: "file", resourceId: "file-exact" }), { projectId: 42, artifactId: null, resourceId: "file-exact" });
  assert.equal(resolveWorkSearchLibraryTarget({ ...result, artifactId: null }), null);
  assert.equal(resolveWorkSearchLibraryTarget({ ...result, projectId: null }), null);
  assert.equal(resolveWorkSearchLibraryTarget({ ...result, kind: "file", resourceId: null }), null);
});
