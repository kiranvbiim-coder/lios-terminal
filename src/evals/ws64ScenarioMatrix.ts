/**
 * WS-64: Seven end-to-end UX acceptance journeys. Source/fixture proof is NOT
 * a real provider, installed-device, 3-company valuation or privacy sign-off.
 * A release cannot claim a scenario complete without source evidence, a
 * recorded installed walkthrough AND the domain-specific owner sign-off.
 */
export const WS64_SCENARIOS = [
  { id: "WS64-01", name: "Source-backed multi-company valuation",
    journey: "Compare Apple, Microsoft and Alphabet, reveal assumptions and sources, review WACC 9%, keep one canonical P4 Artifact and return to Chat",
    sourceCaseIds: ["JR01", "JR02"], requiredManual: ["live_three_entity_comparison", "exact_source_provenance", "governed_wacc_revision", "artifact_chat_restart", "opt_in_monitor_only"] },
  { id: "WS64-02", name: "Non-finance general assistant",
    journey: "Ask for a non-finance writing task without source or AI setup; show useful output only if allowed, preserve prompt otherwise",
    sourceCaseIds: [], requiredManual: ["nonfinance_auth_entry", "general_assistant_response", "keyboard_and_screenreader"] },
  { id: "WS64-03", name: "Connected source with conflicts",
    journey: "Resolve an authorized data connection with exact recorded provider, freshness, conflicts and entitlement; never label test fixtures live",
    sourceCaseIds: ["JR01"], requiredManual: ["real_connected_source", "licence_and_conflict_disclosure", "offline_fallback_truth"] },
  { id: "WS64-04", name: "File-first source-locked insight",
    journey: "Ask about a selected private file; do not invent its contents or transmit anything before file selection/consent",
    sourceCaseIds: ["JR04", "JR05"], requiredManual: ["real_file_upload", "file_to_source_lineage", "delete_and_revoke"] },
  { id: "WS64-05", name: "Denied rights and tenant isolation",
    journey: "Deny access to a revoked source or other owner's Artifact and leave unrelated work intact; block unsafe export and sharing",
    sourceCaseIds: [], requiredManual: ["two_tenant_denial", "live_revoked_entitlement", "recipient_share_review"] },
  { id: "WS64-06", name: "Artifact continuity and client restart",
    journey: "Save governed revision and receipt, change it through existing review, close Home, reopen same Project/Chat/Artifact/version",
    sourceCaseIds: [], requiredManual: ["real_installed_restart", "same_artifact_id_version", "no_dirty_draft_loss"] },
  { id: "WS64-07", name: "Home disconnected and temporary Chat",
    journey: "Preserve unsent prompt and files on disconnect, do not auto-resend, resume same run only with owner receipt; Temporary Chat does not persist",
    sourceCaseIds: [], requiredManual: ["device_disconnect_mid_run", "temporary_chat_no_retention", "safe_manual_retry"] },
] as const;

export type WS64ScenarioId = (typeof WS64_SCENARIOS)[number]["id"];
export type WS64ManualGate = (typeof WS64_SCENARIOS)[number]["requiredManual"][number];

export interface WS64Evidence {
  sourceVerified: boolean;
  /** Gate IDs recorded with genuine installed/connected evidence, not fixtures. */
  installedGateIds: readonly string[];
  ownerSignedOff: boolean;
}

export function assessWS64Scenario(
  id: WS64ScenarioId,
  evidence: WS64Evidence,
): { id: WS64ScenarioId; sourceVerified: boolean; missingInstalledGates: string[]; accepted: boolean } {
  const scenario = WS64_SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`Unknown WS-64 scenario ${id}`);
  const recorded = new Set(evidence.installedGateIds);
  const missingInstalledGates = scenario.requiredManual.filter((gate) => !recorded.has(gate));
  return {
    id,
    sourceVerified: evidence.sourceVerified,
    missingInstalledGates,
    accepted: evidence.sourceVerified && missingInstalledGates.length === 0 && evidence.ownerSignedOff,
  };
}

/** The source suite cannot fabricate target-device qualification evidence. */
export function sourceOnlyWS64Scorecard(
  results: Readonly<Record<WS64ScenarioId, boolean>>,
): Array<ReturnType<typeof assessWS64Scenario>> {
  return WS64_SCENARIOS.map(({ id }) => assessWS64Scenario(id, {
    sourceVerified: results[id],
    installedGateIds: [],
    ownerSignedOff: false,
  }));
}