import { z } from "zod";
import type { GovernedToolDescriptor } from "../governedTools";
import { classifyComputerAction, ComputerAssessmentSchema } from "./risk-policy";

const ComputerAssessmentResultSchema = z.object({
  level: z.enum(["ordinary", "high"]),
  family: z.string(),
  permissionClass: z.enum(["safe_auto", "user_confirm"]),
  sideEffect: z.enum(["none", "external"]),
  replaySafe: z.boolean(),
  targetApp: z.string(),
  windowRef: z.string(),
  captureScope: z.enum(["window", "desktop"]),
  blastRadius: z.enum(["window", "desktop"]),
  action: z.string(),
  assessmentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  nativeAvailable: z.literal(false),
  reason: z.literal("native-transport-unavailable"),
}).strict();
export type ComputerAssessmentResult = z.infer<typeof ComputerAssessmentResultSchema>;

/** Assessment only: never captures a screen, sends input, mints a grant or creates a registry. */
export function computerAssessmentDescriptor<TKind extends string>(
  kind: TKind,
): GovernedToolDescriptor<TKind, ComputerAssessmentResult> {
  return {
    id: "computer.assess",
    label: "Assess computer action risk and prerequisites (does not execute)",
    kind,
    permissionClass: "safe_auto",
    access: "read",
    sideEffect: "none",
    replaySafe: true,
    inputSchema: ComputerAssessmentSchema,
    outputSchema: ComputerAssessmentResultSchema,
    maxOutputBytes: 4096,
    cancel: null,
    invoke: async (input, signal) => {
      if (signal.aborted) throw new Error("Computer assessment cancelled.");
      return {
        ...classifyComputerAction(input),
        nativeAvailable: false,
        reason: "native-transport-unavailable",
      };
    },
  };
}

/** Inject the L1 authority; caller chooses its existing kind/result union. No second tool authority. */
export function registerComputerAssessment<TKind extends string>(
  registry: { register(tool: GovernedToolDescriptor<TKind, ComputerAssessmentResult>): void },
  kind: TKind,
): void {
  registry.register(computerAssessmentDescriptor(kind));
}
