// Imported/adapted from OpenClaw c074824a27c96d3983043f9eeb33823cd1772d8c.
// Copyright (c) 2026 OpenClaw Foundation. MIT; see THIRD_PARTY_NOTICES.md.
import { z } from "zod";
import { createHash } from "node:crypto";
import { parseKeyChord } from "./actions";

export const COMPUTER_ACTION_NAMES = [
  "screenshot",
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "mouse_move",
  "left_click_drag",
  "left_mouse_down",
  "left_mouse_up",
  "scroll",
  "type",
  "key",
  "hold_key",
  "wait",
  "list_apps",
  "list_windows",
  "get_accessibility_tree",
  "get_cursor_position",
  "get_window_state",
  "launch_app",
  "kill_app",
  "bring_to_front",
  "set_value",
  "zoom",
  "get_browser_state",
  "browser_prepare",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_dialog",
  "browser_set_input_files",
  "browser_download",
  "browser_pointer",
  "escalate_scope",
  "get_recording_state",
  "start_recording",
  "stop_recording",
  "replay_trajectory",
  "invoke_menu",
] as const;

export type ComputerActionName = (typeof COMPUTER_ACTION_NAMES)[number];

const HIGH_RISK_FAMILIES = new Map<
  ComputerActionName,
  string
>([
  ["kill_app", "process_termination"],
  ["browser_navigate", "browser_navigation"],
  ["browser_download", "browser_download"],
  ["browser_set_input_files", "browser_file_input"],
  ["start_recording", "recording_start"],
  ["replay_trajectory", "recording_replay"],
  ["escalate_scope", "desktop_scope_escalation"],
]);

const OBSERVATION_ACTIONS = new Set<ComputerActionName>([
  "list_apps",
  "list_windows",
  "get_accessibility_tree",
  "get_cursor_position",
  "get_window_state",
  "zoom",
  "get_browser_state",
  "get_recording_state",
]);

// This is an assessment descriptor, never a native action payload or grant.
export const ComputerAssessmentSchema = z.object({
  action: z.enum(COMPUTER_ACTION_NAMES),
  targetApp: z.string().trim().min(1).max(256),
  windowRef: z.string().min(1).max(256),
  captureScope: z.enum(["window", "desktop"]),
  dialogAction: z.enum(["inspect", "accept", "dismiss"]).optional(),
  keys: z.string().min(1).max(256).optional(),
}).strict().superRefine((value, context) => {
  if ((value.action === "browser_dialog") !== (value.dialogAction !== undefined)) {
    context.addIssue({ code: "custom", message: "dialogAction is required only for browser_dialog" });
  }
  if (["key", "hold_key"].includes(value.action) !== (value.keys !== undefined)) {
    context.addIssue({ code: "custom", message: "keys are required only for key actions" });
  }
});
export type ComputerAssessment = z.infer<typeof ComputerAssessmentSchema>;

export function classifyComputerAction(input: unknown) {
  const parsed = ComputerAssessmentSchema.parse(input);
  if (parsed.keys) parseKeyChord(parsed.keys, process.platform);
  const highRiskFamily = HIGH_RISK_FAMILIES.get(parsed.action);
  // Screenshot and local pacing never traverse donor computer.act. Explicitly
  // classify them here; all input, even an ordinary click, requires confirmation.
  const observation = OBSERVATION_ACTIONS.has(parsed.action) || parsed.action === "screenshot"
    || parsed.action === "wait" || (parsed.action === "browser_dialog" && parsed.dialogAction === "inspect");
  const risk = highRiskFamily
    ? { level: "high" as const, family: highRiskFamily }
    : { level: "ordinary" as const, family: observation ? "observation" : "input" };
  return {
    ...risk,
    permissionClass: observation ? "safe_auto" as const : "user_confirm" as const,
    sideEffect: observation ? "none" as const : "external" as const,
    replaySafe: observation,
    targetApp: parsed.targetApp,
    windowRef: parsed.windowRef,
    captureScope: parsed.captureScope,
    blastRadius: parsed.captureScope === "desktop" ? "desktop" as const : "window" as const,
    action: parsed.action,
    // Assessment identity is not native-operation identity or an approval token.
    assessmentDigest: createHash("sha256").update(JSON.stringify(parsed)).digest("hex"),
  };
}
