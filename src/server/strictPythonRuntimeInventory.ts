/**
 * Required-pack presence contract for strict one-shot numerical calculations.
 * The passive inventory lists optional packs as "unavailable". A response from
 * /runtime-info proves transport only, NOT that required numerical packs exist.
 *
 * This checks metadata, not ABI correctness or an actual worker calculation:
 * the sandbox-image worker smoke and SP-01 strict valuation must prove those.
 */
export const STRICT_NUMERICAL_PACKS = ["numpy", "scipy", "pydantic"] as const;

export function assertStrictNumericalPackInventory(packages: Readonly<Record<string, string>>): void {
  for (const name of STRICT_NUMERICAL_PACKS) {
    const reported = Object.hasOwn(packages, name) ? packages[name] : undefined;
    if (typeof reported !== "string" || !reported.trim() ||
        ["unavailable", "unknown", "missing"].includes(reported.trim().toLowerCase())) {
      throw new Error(`Strict numerical runtime is missing the required ${name} package. The sandbox is not ready for valuation; no host fallback is permitted.`);
    }
  }
}
