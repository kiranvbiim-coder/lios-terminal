import assert from "node:assert/strict";
import test from "node:test";
import { capabilitiesForEntity, ENTITY_GROUPS } from "./entityCapabilities";
import { parseTerminalCommand } from "./terminalCommands";

test("entity capability map exposes every research workspace group", () => {
  const groups = new Set(capabilitiesForEntity().map((capability) => capability.group));
  for (const group of ENTITY_GROUPS) assert.equal(groups.has(group.id), true, `missing ${group.id}`);
});

test("entity workflow exposes a direct DCF action and honest data states", () => {
  const capabilities = capabilitiesForEntity();
  assert.equal(capabilities.find((capability) => capability.id === "dcf")?.actionLabel, "RUN DCF");
  assert.equal(capabilities.find((capability) => capability.id === "options")?.status, "requires_data");
});

test("terminal aliases route home and entity commands to contextual views", () => {
  assert.deepEqual(parseTerminalCommand("HOME"), { raw: "HOME", view: "missioncontrol" });
  assert.deepEqual(parseTerminalCommand("MSFT ENTITY"), { raw: "MSFT ENTITY", symbol: "MSFT", view: "entity" });
});
