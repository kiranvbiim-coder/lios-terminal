import { z } from "zod";

/** Chat-facing *summary* of canonical P13 and saved MCP metadata.
 * Never includes executable package contents, endpoint, secret reference,
 * raw manifest, tool arguments or remote tool output. */
export const chatExtensionCatalogSchema = z.object({
  plugins: z.array(z.object({
    id: z.string().min(1).max(180),
    name: z.string().min(1).max(240),
    version: z.string().max(80),
    skillCount: z.number().int().nonnegative(),
    artifactCount: z.number().int().nonnegative(),
    trusted: z.boolean(),
    registered: z.boolean(),
    executableFromChat: z.literal(false),
  }).strict()).max(100),
  mcpConnections: z.array(z.object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(240),
    status: z.enum(["healthy", "configured", "degraded", "unreachable", "invalid"]),
    projectRequired: z.literal(true),
    explicitApprovalRequired: z.literal(true),
  }).strict()).max(100),
  installationManagedByHomeOwner: z.literal(true),
}).strict();
export type ChatExtensionCatalog = z.infer<typeof chatExtensionCatalogSchema>;
