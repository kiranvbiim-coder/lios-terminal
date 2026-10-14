import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import {
  hasPrivilegedPluginPermissions,
  liosPluginManifestV1Schema,
  type LiosPluginManifestV1,
} from "@shared/pluginSdk";
import type { PluginTrustState } from "./p13PluginTrust";
import type { RuntimeExecutionContext } from "@shared/runtimeContracts";
import { nodeNetworkDenyImport, nodePermissionModelFlag } from "./exec/node-isolation";

export const pluginExecutionGrantSchema = z.object({
  projectRoot: z.string().trim().min(1).nullable().default(null),
  userSelectedReadRoots: z.array(z.string().trim().min(1)).max(50).default([]),
  userSelectedWriteRoots: z.array(z.string().trim().min(1)).max(50).default([]),
  networkHosts: z.array(z.string().trim().min(1).max(253)).max(100).default([]),
  allowProcessSpawn: z.boolean().default(false),
}).strict();
export type PluginExecutionGrant = z.infer<typeof pluginExecutionGrantSchema>;

/**
 * Canonical server-owned, per-read scope authority for the existing P13 broker.
 * The caller must bind the exact user/org/Project to the selected root using
 * current (revocable) host authority. Never supply this from plugin payloads.
 */
export type P13PluginFileReadAuthorizer = (input: {
  context: RuntimeExecutionContext;
  componentId: string;
  scope: "project" | "user_selected";
  root: string;
  rootIndex: number;
}) => boolean | Promise<boolean>;

export interface PluginNodeLaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(".." + path.sep)
    && !path.isAbsolute(relative)
  );
}

const SAFE_INHERITED_ENV_KEYS = [
  "PATH",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
] as const;

const MAX_PLUGIN_INSTALL_TREE_ENTRIES = 20_000;

function realExistingPath(value: string): string {
  return fs.realpathSync.native(path.resolve(value));
}

function resolvedRoots(values: string[]): string[] {
  return [...new Set(values.map(realExistingPath))];
}

function safePluginEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of SAFE_INHERITED_ENV_KEYS) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function resolveBrokerCandidate(candidatePath: string, mode: "read" | "write"): string {
  const resolved = path.resolve(candidatePath);
  // existsSync() follows the final symlink and returns false for dangling links.
  // A broker write must not mistake a dangling out-of-root link for a new file.
  let entry: ReturnType<typeof fs.lstatSync> | null = null;
  try {
    entry = fs.lstatSync(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || mode === "read") {
      throw error;
    }
  }
  if (entry) {
    if (entry.isSymbolicLink()) {
      throw new Error("Plugin filesystem broker rejects symbolic-link file targets.");
    }
    if (!entry.isFile()) {
      throw new Error("Plugin filesystem broker only permits regular-file targets.");
    }
    return realExistingPath(resolved);
  }
  const parent = realExistingPath(path.dirname(resolved));
  if (!fs.statSync(parent).isDirectory()) {
    throw new Error("Plugin filesystem broker requires an existing directory parent.");
  }
  return path.join(parent, path.basename(resolved));
}

function assertSafePluginInstallTree(root: string): void {
  const pending = [root];
  let entries = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > MAX_PLUGIN_INSTALL_TREE_ENTRIES) {
        throw new Error("Plugin install tree exceeds the bounded entry limit.");
      }
      const candidate = path.join(directory, entry.name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        throw new Error("Plugin install tree contains a symbolic link; direct plugin-code read authority is refused.");
      }
      if (stat.isDirectory()) {
        pending.push(candidate);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error("Plugin install tree contains a non-regular filesystem entry.");
      }
    }
  }
}
function assertPermissionGrant(
  manifest: LiosPluginManifestV1,
  trustState: PluginTrustState,
  grant: PluginExecutionGrant,
): void {
  if ((hasPrivilegedPluginPermissions(manifest) || manifest.runtime.kind !== "declarative") && trustState !== "trusted") {
    throw new Error("Executable or privileged plugins require a trusted signature.");
  }

  const permissions = new Set(manifest.permissions);
  if (
    (permissions.has("filesystem.project.read") || permissions.has("filesystem.project.write"))
    && !grant.projectRoot
  ) {
    throw new Error("Project filesystem permission requires an explicit project root grant.");
  }
  if (permissions.has("filesystem.user_selected.read") && grant.userSelectedReadRoots.length === 0) {
    throw new Error("User-selected filesystem read permission requires explicit roots.");
  }
  if (permissions.has("filesystem.user_selected.write") && grant.userSelectedWriteRoots.length === 0) {
    throw new Error("User-selected filesystem write permission requires explicit roots.");
  }
  if (permissions.has("network.http") && grant.networkHosts.length === 0) {
    throw new Error("Network permission requires an explicit host allowlist.");
  }
  if (permissions.has("process.spawn") || grant.allowProcessSpawn) {
    throw new Error("Direct process spawning is not permitted in the Node plugin sandbox.");
  }
}

function addFsFlag(args: string[], flag: "--allow-fs-read" | "--allow-fs-write", root: string): void {
  args.push(flag + "=" + path.resolve(root));
}

export function buildNodePluginLaunchPlan(input: {
  manifest: LiosPluginManifestV1;
  installDirectory: string;
  trustState: PluginTrustState;
  grant: PluginExecutionGrant;
  authorizeFileRead?: P13PluginFileReadAuthorizer;
}): PluginNodeLaunchPlan {
  const manifest = liosPluginManifestV1Schema.parse(input.manifest);
  const grant = pluginExecutionGrantSchema.parse(input.grant);

  if (manifest.runtime.kind !== "node_process") {
    throw new Error("Node plugin host only launches node_process plugins.");
  }
  if (!manifest.runtime.entrypoint) throw new Error("Plugin entrypoint is required.");

  assertPermissionGrant(manifest, input.trustState, grant);
  const permissions = new Set(manifest.permissions);
  if (permissions.has("filesystem.project.write") || permissions.has("filesystem.user_selected.write")) {
    throw new Error(
      "Plugin filesystem write permissions require a qualified brokered write-return lifecycle.",
    );
  }
  const needsBrokeredRead = permissions.has("filesystem.project.read") || permissions.has("filesystem.user_selected.read");
  if (needsBrokeredRead && !input.authorizeFileRead) {
    throw new Error(
      "Plugin filesystem permissions require brokered filesystem transport with a server-owned read scope authorizer.",
    );
  }

  const installDirectory = realExistingPath(input.installDirectory);
  assertSafePluginInstallTree(installDirectory);
  const entrypointCandidate = path.resolve(installDirectory, manifest.runtime.entrypoint);
  if (!isWithin(installDirectory, entrypointCandidate)) {
    throw new Error("Plugin entrypoint must remain inside its install directory.");
  }
  const entrypoint = realExistingPath(entrypointCandidate);
  if (!isWithin(installDirectory, entrypoint)) {
    throw new Error("Plugin entrypoint symlink resolves outside its install directory.");
  }

  const args: string[] = [nodePermissionModelFlag(), "--import=" + nodeNetworkDenyImport("LIOS_PLUGIN_RAW_NETWORK_DENIED")];
  addFsFlag(args, "--allow-fs-read", installDirectory);
  // Project and user-selected roots are intentionally not granted to the child.
  // Node's path permission model is not a symlink-safe workspace boundary.
  // Those permissions must cross the canonical host-side broker/copy authority.
  args.push(entrypoint);

  return {
    command: process.execPath,
    args,
    cwd: installDirectory,
    env: {
      ...safePluginEnvironment(),
      LIOS_PLUGIN_ID: manifest.id,
      LIOS_PLUGIN_SDK_VERSION: manifest.apiVersion,
      LIOS_PLUGIN_NETWORK_BROKER: permissions.has("network.http") ? "required" : "disabled",
      LIOS_PLUGIN_FILESYSTEM_BROKER: needsBrokeredRead ? "read-only" : "disabled",
      LIOS_PLUGIN_RAW_NETWORK: "denied",
      LIOS_PLUGIN_PROCESS_SPAWN: "denied",
    },
  };
}

export function launchNodePlugin(plan: PluginNodeLaunchPlan): ChildProcess {
  return spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    env: plan.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

export function authorizeBrokeredNetworkRequest(
  inputUrl: string,
  manifestInput: LiosPluginManifestV1,
  grantInput: PluginExecutionGrant,
): URL {
  const manifest = liosPluginManifestV1Schema.parse(manifestInput);
  const grant = pluginExecutionGrantSchema.parse(grantInput);
  if (!manifest.permissions.includes("network.http")) throw new Error("Plugin has no network.http permission.");

  const url = new URL(inputUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Plugin network broker only permits HTTP(S).");
  }

  const hostname = url.hostname.toLowerCase();
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  const actualPort = url.port || defaultPort;
  const allowed = new Set(grant.networkHosts.map((host) => host.trim().toLowerCase()));
  const defaultHostAllowed = actualPort === defaultPort && allowed.has(hostname);
  const exactHostPortAllowed = allowed.has(hostname + ":" + actualPort);
  if (!defaultHostAllowed && !exactHostPortAllowed) {
    throw new Error("Plugin network host/port is outside the explicit allowlist.");
  }
  return url;
}

export function authorizeBrokeredFilePath(
  candidatePath: string,
  mode: "read" | "write",
  manifestInput: LiosPluginManifestV1,
  grantInput: PluginExecutionGrant,
): string {
  const manifest = liosPluginManifestV1Schema.parse(manifestInput);
  const grant = pluginExecutionGrantSchema.parse(grantInput);
  const resolved = resolveBrokerCandidate(candidatePath, mode);
  const permissions = new Set(manifest.permissions);

  const roots: string[] = [];
  if (grant.projectRoot && permissions.has(mode === "read" ? "filesystem.project.read" : "filesystem.project.write")) {
    roots.push(realExistingPath(grant.projectRoot));
  }
  const userPermission = mode === "read" ? "filesystem.user_selected.read" : "filesystem.user_selected.write";
  if (permissions.has(userPermission)) {
    roots.push(...resolvedRoots(mode === "read" ? grant.userSelectedReadRoots : grant.userSelectedWriteRoots));
  }

  if (!roots.some((root) => isWithin(root, resolved))) {
    throw new Error("Plugin filesystem request is outside granted roots.");
  }
  return resolved;
}
