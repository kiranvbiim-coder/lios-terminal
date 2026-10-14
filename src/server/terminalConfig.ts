import fs from "fs";
import path from "path";
import { invalidateVaultCache, isCredentialAvailable, resolveCredential } from "./credentialVault";
import { dataPath } from "./dataRoot";

export type TerminalConfig = Record<string, unknown>;

let cachedConfig: TerminalConfig | null = null;
let cachedPath: string | null = null;

export function terminalConfigPath(): string {
  return dataPath("config.json");
}

export function readTerminalConfig(): TerminalConfig {
  const configPath = terminalConfigPath();
  if (cachedConfig && cachedPath === configPath) return cachedConfig;

  try {
    cachedPath = configPath;
    cachedConfig = fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, "utf8")) as TerminalConfig
      : {};
    return cachedConfig;
  } catch {
    cachedConfig = {};
    cachedPath = configPath;
    return cachedConfig;
  }
}

/** Invalidate both terminal config and vault caches. Used by tests that switch HOME. */
export function invalidateConfigCache(): void {
  cachedConfig = null;
  cachedPath = null;
  invalidateVaultCache();
}

export function getConfigString(key: string): string | null {
  const value = readTerminalConfig()[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function getConfigBoolean(key: string): boolean {
  return readTerminalConfig()[key] === true;
}

export function getCredential(envName: string, configName: string): string | null {
  return resolveCredential(envName, configName);
}

export function isEnabled(envName: string, configName: string): boolean {
  return process.env[envName] === "true" || getConfigBoolean(configName);
}

export function hasCredential(envName: string, configName: string): boolean {
  return isCredentialAvailable(envName, configName);
}
