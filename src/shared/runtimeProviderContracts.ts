/**
 * GM-02 — replaceable runtime provider seams (docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md §5).
 *
 * This module adds NO registry. Providers are ordinary `RuntimeComponentDescriptor`s held by the
 * existing `RuntimeRegistry`; here we only define
 *   - which component kind fills each infrastructure slot,
 *   - the capability tags providers use to state who operates them and which Home modes they support,
 *   - a "Home profile" (which provider fills each slot), and
 *   - a pure conformance check for the owner rule "LiOS operates no customer runtime server".
 *
 * Behavioural interfaces (StorageProvider.put/get, SecretProvider.resolve, DatabaseProvider.relocate…)
 * are deliberately NOT defined here. Each is defined by its owning GM task (GM-04/05/06/07/10) against
 * real code, so the registry seam is not reshaped by speculative APIs.
 */
import { z } from "zod";
import type { RuntimeComponentDescriptor, RuntimeComponentKind } from "./runtimeContracts";

/** Where a LiOS Home runs. Desktop Local is the zero-configuration default. */
export const runtimeModeSchema = z.enum(["desktop_local", "user_home_server"]);
export type RuntimeMode = z.infer<typeof runtimeModeSchema>;

/** Infrastructure slots and the component kind that must fill each. */
export const HOME_PROVIDER_SLOTS = {
  database: "database_provider",
  storage: "storage_provider",
  secrets: "secret_provider",
  execution: "execution_backend",
  identity: "identity_provider",
  license: "license_provider",
  network: "network_provider",
  backup: "backup_provider",
  notification: "notification_provider",
  browser: "browser_provider",
} as const satisfies Record<string, RuntimeComponentKind>;
export type HomeProviderSlot = keyof typeof HOME_PROVIDER_SLOTS;

/** Required slots that take an ordered list (resolution chain / multiple targets). An empty list is a reported gap. */
export const CHAIN_HOME_SLOTS = ["secrets", "backup"] as const satisfies readonly HomeProviderSlot[];

/** Capability tags on a provider descriptor. */
export const PROVIDER_OPERATOR_USER = "operator:user";
export const PROVIDER_OPERATOR_VENDOR = "operator:vendor";
export const providerModeCapability = (mode: RuntimeMode): string => `mode:${mode}`;

const providerIdSchema = z.string().trim().min(1).max(300).regex(/^[a-z0-9][a-z0-9._:-]*$/);

export const homeProfileSchema = z.object({
  mode: runtimeModeSchema,
  database: providerIdSchema,
  storage: providerIdSchema,
  secrets: z.array(providerIdSchema).max(8),
  execution: providerIdSchema,
  identity: providerIdSchema,
  license: providerIdSchema,
  network: providerIdSchema,
  backup: z.array(providerIdSchema).max(8),
  notification: providerIdSchema.nullable(),
  browser: providerIdSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  for (const slot of CHAIN_HOME_SLOTS) {
    if (new Set(value[slot]).size !== value[slot].length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [slot], message: `Provider chain "${slot}" must not repeat a provider.` });
    }
  }
});
export type HomeProfile = z.infer<typeof homeProfileSchema>;

export type HomeConformanceIssueCode =
  | "required_slot_empty"
  | "unknown_provider"
  | "wrong_kind"
  | "mode_incompatible"
  | "vendor_operated_runtime_dependency"
  | "operator_undeclared";

export interface HomeConformanceIssue {
  slot: HomeProviderSlot;
  providerId: string;
  code: HomeConformanceIssueCode;
  message: string;
}

export interface HomeConformanceReport {
  mode: RuntimeMode;
  /** True only when no issue was found: every selected provider exists, fits its slot and mode, and is user-operated. */
  conformant: boolean;
  issues: HomeConformanceIssue[];
  selected: Array<{ slot: HomeProviderSlot; providerId: string }>;
}

export function homeProfileProviderIds(profile: HomeProfile): Array<{ slot: HomeProviderSlot; providerId: string }> {
  const selected: Array<{ slot: HomeProviderSlot; providerId: string }> = [];
  for (const slot of Object.keys(HOME_PROVIDER_SLOTS) as HomeProviderSlot[]) {
    const value = profile[slot];
    if (value === null) continue;
    for (const providerId of Array.isArray(value) ? value : [value]) selected.push({ slot, providerId });
  }
  return selected;
}

/**
 * Checks a Home profile against the registered provider descriptors.
 *
 * "Vendor-operated" means the provider declares `operator:vendor`: a service LiOS (the vendor) runs.
 * Such a provider may be *registered* (so the inventory is honest about what the code still depends on)
 * but a conformant profile never selects it. A provider that declares neither operator tag is reported
 * rather than assumed to be user-owned.
 */
export function evaluateHomeProfile(
  profileInput: HomeProfile,
  descriptors: readonly RuntimeComponentDescriptor[],
): HomeConformanceReport {
  const profile = homeProfileSchema.parse(profileInput);
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  const selected = homeProfileProviderIds(profile);
  const issues: HomeConformanceIssue[] = [];

  // A required chain with no provider is a real gap (e.g. no backup for a user-managed database on a server Home).
  for (const slot of CHAIN_HOME_SLOTS) {
    if (profile[slot].length === 0) {
      issues.push({ slot, providerId: "(none)", code: "required_slot_empty", message: `No provider is selected for required slot "${slot}".` });
    }
  }

  for (const { slot, providerId } of selected) {
    const descriptor = byId.get(providerId);
    if (!descriptor) {
      issues.push({ slot, providerId, code: "unknown_provider", message: `Provider "${providerId}" is not registered.` });
      continue;
    }
    if (descriptor.kind !== HOME_PROVIDER_SLOTS[slot]) {
      issues.push({ slot, providerId, code: "wrong_kind", message: `Provider "${providerId}" is a ${descriptor.kind}, but slot "${slot}" requires ${HOME_PROVIDER_SLOTS[slot]}.` });
      continue;
    }
    if (!descriptor.capabilities.includes(providerModeCapability(profile.mode))) {
      issues.push({ slot, providerId, code: "mode_incompatible", message: `Provider "${providerId}" does not declare support for mode ${profile.mode}.` });
    }
    const vendor = descriptor.capabilities.includes(PROVIDER_OPERATOR_VENDOR);
    const user = descriptor.capabilities.includes(PROVIDER_OPERATOR_USER);
    if (vendor) {
      issues.push({ slot, providerId, code: "vendor_operated_runtime_dependency", message: `Provider "${providerId}" is operated by the vendor; a LiOS Home must not depend on it at runtime.` });
    } else if (!user) {
      issues.push({ slot, providerId, code: "operator_undeclared", message: `Provider "${providerId}" does not declare who operates it.` });
    }
  }

  return { mode: profile.mode, conformant: issues.length === 0, issues, selected };
}
