/**
 * SecretRef grammar for user-owned secrets (GM-07).
 *
 * Adapted from OpenClaw `src/secrets/ref-contract.ts` (MIT, commit c074824a27c96d3983043f9eeb33823cd1772d8c):
 * the `{ source, provider, id }` shape, the strict env id pattern, the provider-alias pattern and `secretRefKey`.
 * LiOS sources are `env`, `file` and `vault`; OpenClaw's `exec` source (runs an operator command) is deliberately
 * not adopted, and `store` is the LiOS `vault`.
 *
 * Text form (what lives in `source_connections.credential_ref` or a `*_REF` setting):
 *   env:LIOS_SECRET_FRED_KEY   an operator-staged environment variable (must start with LIOS_SECRET_)
 *   file:/run/secrets/fred     a private file in an operator-approved secrets directory
 *   vault:fred_api_key         an entry in the LiOS credential vault
 *   fred_api_key               (no scheme) the same vault entry; the original form, still accepted
 */
export type SecretRefSource = "env" | "file" | "vault";

export interface SecretRef {
  source: SecretRefSource;
  provider: string;
  id: string;
}

export const DEFAULT_SECRET_PROVIDER_ALIAS = "default";
export const SECRET_PROVIDER_ALIAS_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
/** Operator-staged variables only: a user-supplied reference must never be able to name DATABASE_URL or SESSION_SECRET. */
export const SECRET_ENV_PREFIX = "LIOS_SECRET_";
export const ENV_SECRET_REF_ID_RE = /^LIOS_SECRET_[A-Z0-9_]{1,110}$/;
const VAULT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SCHEME_RE = /^(env|file|vault):/;

export function secretRefKey(ref: SecretRef): string {
  return `${ref.source}:${ref.provider}:${ref.id}`;
}

/** Returns null for a value that is not a valid reference (so callers can refuse rather than guess). */
export function parseSecretRef(text: string): SecretRef | null {
  const value = text.trim();
  if (!value || /[\0\r\n]/.test(value)) return null;
  const scheme = SCHEME_RE.exec(value);
  const source = (scheme?.[1] ?? "vault") as SecretRefSource;
  const id = scheme ? value.slice(scheme[0].length) : value;
  if (source === "env" && !ENV_SECRET_REF_ID_RE.test(id)) return null;
  if (source === "vault" && !VAULT_NAME_RE.test(id)) return null;
  if (source === "file" && (id.length > 1024 || !/^(\/|[A-Za-z]:[\\/])/.test(id))) return null;
  return { source, provider: DEFAULT_SECRET_PROVIDER_ALIAS, id };
}
