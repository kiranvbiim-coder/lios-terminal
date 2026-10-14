// Adapted from OpenClaw src/process/supervisor/adapters/env.ts (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS (GM-10a) modifications: toStringEnv kept verbatim; inherited environment is allow-listed.
// GM-11b.1 rejects command-interpreter and loader injection overrides. Managed Python retains only
// its existing explicit environment keys through the fixed python-runtime profile.

const INHERITED_ENV_KEYS = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TERM"];
const WIN32_INHERITED_ENV_KEYS = ["SYSTEMROOT", "COMSPEC", "PATHEXT"];
const SECRET_ENV_NAME = /key|token|secret|password|credential|cookie|session/i;
const PYTHON_RUNTIME_ENV_KEYS: Record<string, true> = {
  PYTHONHOME: true,
  PYTHONPATH: true,
  PYTHONUSERBASE: true,
  PYTHONNOUSERSITE: true,
  PYTHONDONTWRITEBYTECODE: true,
  VIRTUAL_ENV: true,
  CONDA_PREFIX: true,
  CONDA_DEFAULT_ENV: true,
  PIP_CONFIG_FILE: true,
  PIP_INDEX_URL: true,
  PIP_EXTRA_INDEX_URL: true,
  PIP_NO_INDEX: true,
  PIP_FIND_LINKS: true,
  PIP_TRUSTED_HOST: true,
  PIP_CERT: true,
  PIP_CLIENT_CERT: true,
  PIP_PROXY: true,
  PIP_CACHE_DIR: true,
  HTTP_PROXY: true,
  HTTPS_PROXY: true,
  ALL_PROXY: true,
  NO_PROXY: true,
  http_proxy: true,
  https_proxy: true,
  all_proxy: true,
  no_proxy: true,
  SSL_CERT_FILE: true,
  SSL_CERT_DIR: true,
  REQUESTS_CA_BUNDLE: true,
  CURL_CA_BUNDLE: true,
};
const PYTHON_RUNTIME_ENV_KEY_NAMES = Object.keys(PYTHON_RUNTIME_ENV_KEYS);
const BLOCKED_ENVIRONMENT_KEYS: Record<string, true> = {
  NODE_OPTIONS: true,
  NODE_PATH: true,
  PYTHONHOME: true,
  PYTHONPATH: true,
  BASH_ENV: true,
  ENV: true,
};

export type ChildEnvProfile = "default" | "python-runtime";

/** Variable names that look like they carry credentials. */
export function isSecretEnvName(name: string): boolean {
  return SECRET_ENV_NAME.test(name);
}

/** Convert Node's optional env values into the concrete string map spawn adapters expect. */
export function toStringEnv(env?: NodeJS.ProcessEnv): Record<string, string> {
  if (!env) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function assertChildEnvOverride(name: string, profile: ChildEnvProfile): void {
  const normalized = name.toUpperCase();
  const profileAllows = profile === "python-runtime" && Object.hasOwn(PYTHON_RUNTIME_ENV_KEYS, normalized);
  const blocked = Object.hasOwn(BLOCKED_ENVIRONMENT_KEYS, normalized) ||
    normalized.startsWith("GIT_") ||
    normalized.startsWith("NPM_CONFIG_") ||
    normalized.startsWith("LD_") ||
    normalized.startsWith("DYLD_");
  if (blocked && !profileAllows) {
    throw new Error(`Unsafe child environment override: ${normalized}`);
  }
  if (profile === "python-runtime" && !profileAllows) {
    throw new Error(`Environment variable is not allowed by the python-runtime profile: ${normalized}`);
  }
}

/** Select only the existing Python runtime settings; never copy the whole server environment. */
export function pythonRuntimeEnvOverlay(
  overrides: NodeJS.ProcessEnv = {},
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of PYTHON_RUNTIME_ENV_KEY_NAMES) {
    const value = source[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  for (const [name, value] of Object.entries(overrides)) {
    assertChildEnvOverride(name, "python-runtime");
    if (value === undefined) {
      delete env[name];
    } else {
      env[name] = value;
    }
  }
  return env;
}

/**
 * Child environment: allow-listed parent variables with explicit overlays checked at the launch
 * boundary. The python-runtime profile is fixed to the existing Python installer/runtime keys.
 */
export function buildChildEnv(
  explicit?: NodeJS.ProcessEnv,
  parent: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  profile: ChildEnvProfile = "default",
): Record<string, string> {
  if (profile !== "default" && profile !== "python-runtime") {
    throw new Error("Unknown child environment profile.");
  }
  const win32 = platform === "win32";
  const allowed = win32 ? [...INHERITED_ENV_KEYS, ...WIN32_INHERITED_ENV_KEYS] : INHERITED_ENV_KEYS;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined || isSecretEnvName(name)) {
      continue;
    }
    // Windows environment names are case-insensitive ("Path").
    const comparable = win32 ? name.toUpperCase() : name;
    if (allowed.includes(comparable)) {
      out[comparable] = value;
    }
  }
  for (const name of Object.keys(explicit ?? {})) {
    assertChildEnvOverride(name, profile);
    delete out[win32 ? name.toUpperCase() : name];
  }
  for (const [name, value] of Object.entries(toStringEnv(explicit))) {
    out[win32 ? name.toUpperCase() : name] = value;
  }
  return out;
}
