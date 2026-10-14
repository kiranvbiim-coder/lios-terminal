import { z } from "zod";

export const CLIENT_AI_CONTEXT_VERSION = "v1";

export const clientAiContextSchema = z.object({
  symbol: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9.^_=-]+$/).optional(),
  view: z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/i).optional(),
  asOfDate: z.string().date().optional(),
}).strict();

export type ClientAiContext = z.infer<typeof clientAiContextSchema>;

export function buildClientAiContextInstruction(context: ClientAiContext | null | undefined): string {
  if (!context) return "";
  const parsed = clientAiContextSchema.safeParse(context);
  if (!parsed.success) return "";

  const parts = [
    parsed.data.symbol ? `active security/entity: ${parsed.data.symbol.toUpperCase()}` : null,
    parsed.data.view ? `source screen: ${parsed.data.view}` : null,
    parsed.data.asOfDate ? `as-known-on date: ${parsed.data.asOfDate}` : null,
  ].filter(Boolean);

  if (!parts.length) return "";

  return [
    `Current LiOS navigation context (${CLIENT_AI_CONTEXT_VERSION}): ${parts.join("; ")}.`,
    "This is navigation metadata only. Do not claim to see screen values, model outputs, portfolio data, files, or provider data unless they are explicitly supplied in the conversation or through an authorized LiOS tool.",
  ].join(" ");
}
