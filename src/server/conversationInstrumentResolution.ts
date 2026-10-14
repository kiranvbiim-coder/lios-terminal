import type { InstrumentResolutionQuery, InstrumentResolutionResult } from "@shared/globalInstrumentMaster";

/**
 * Conversation entity extraction can only guess whether a bare word is a ticker or a company
 * name ("chart of apple" -> APPLE vs "chart aapl"). Resolve as a ticker first; if that finds
 * nothing, retry the same text as a company name. Ambiguity is never resolved by guessing.
 */
export async function resolveConversationInstrument(
  input: { symbol?: string; name?: string },
  resolve: (query: InstrumentResolutionQuery) => Promise<InstrumentResolutionResult>,
): Promise<InstrumentResolutionResult> {
  const symbol = (input.symbol ?? "").trim().toUpperCase();
  const name = (input.name ?? "").trim();
  if (!symbol && !name) throw new Error("Instrument resolution requires a symbol or company/security name.");
  if (!symbol) return resolve({ name });

  const byTicker = await resolve({ ticker: symbol });
  if (byTicker.match || byTicker.status === "ambiguous") return byTicker;
  return resolve({ name: name || symbol });
}
