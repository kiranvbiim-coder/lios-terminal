import fs from "node:fs";
import path from "node:path";
import { parseConnectorPluginManifest } from "@shared/connectorPlugin";
import type { ConnectorDefinition } from "@shared/connectorRegistry";
import { dataPath } from "./dataRoot";

export interface ConnectorPluginDiscoveryResult {
  directory: string;
  definitions: ConnectorDefinition[];
  rejectedFiles: Array<{ file: string; reason: string }>;
}

export function resolveConnectorPluginDirectory(): string {
  return path.resolve(process.env.LIMURIA_CONNECTOR_DIR || path.join(process.env.LIMURIA_WORKSPACE_DIR || dataPath("workspace"), "connectors"));
}

export function discoverConnectorPlugins(directory = resolveConnectorPluginDirectory()): ConnectorPluginDiscoveryResult {
  const resolvedDirectory = path.resolve(directory);
  fs.mkdirSync(resolvedDirectory, { recursive: true, mode: 0o700 });
  const rejectedFiles: Array<{ file: string; reason: string }> = [];
  const definitions: ConnectorDefinition[] = [];
  const ids = new Set<string>();
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(resolvedDirectory, { withFileTypes: true });
  } catch (error) {
    rejectedFiles.push({ file: resolvedDirectory, reason: error instanceof Error ? error.message : "Directory could not be read." });
    return { directory: resolvedDirectory, definitions, rejectedFiles };
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(resolvedDirectory, entry.name);
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      const definition = parseConnectorPluginManifest(raw);
      if (!definition) {
        rejectedFiles.push({ file: entry.name, reason: "Manifest failed the connector plugin schema." });
      } else if (ids.has(definition.id)) {
        rejectedFiles.push({ file: entry.name, reason: `Duplicate connector id ${definition.id}.` });
      } else {
        ids.add(definition.id);
        definitions.push(definition);
      }
    } catch (error) {
      rejectedFiles.push({ file: entry.name, reason: error instanceof Error ? error.message : "Manifest is not valid JSON." });
    }
  }
  return { directory: resolvedDirectory, definitions, rejectedFiles };
}
