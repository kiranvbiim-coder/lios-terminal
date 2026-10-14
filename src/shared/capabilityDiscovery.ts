import { z } from "zod";
import {
  capabilityAvailabilitySchema,
  capabilityExecutionTargetSchema,
  capabilitySourceSchema,
  capabilitySurfaceSchema,
} from "./capability";

export const capabilityDiscoveryResultSchema = z.object({
  capabilityId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  availability: capabilityAvailabilitySchema,
  executionTarget: capabilityExecutionTargetSchema,
  sourceKind: capabilitySourceSchema.shape.kind,
  invocable: z.boolean(),
  preferredView: z.string().min(1).nullable(),
  existingSurfaces: z.array(z.string()),
  score: z.number(),
  matchedOn: z.array(z.string()),
});

export const capabilityDiscoveryResponseSchema = z.object({
  query: z.string(),
  surface: capabilitySurfaceSchema,
  count: z.number().int().nonnegative(),
  results: z.array(capabilityDiscoveryResultSchema),
});

export type CapabilityDiscoveryResult = z.infer<typeof capabilityDiscoveryResultSchema>;
export type CapabilityDiscoveryResponse = z.infer<typeof capabilityDiscoveryResponseSchema>;
