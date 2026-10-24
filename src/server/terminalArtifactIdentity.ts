import type { ArtifactContent } from "@shared/artifactContracts";
import { readTerminalScreenState } from "@shared/terminalArtifact";
import { resolvePersistedInstrument } from "./globalInstrumentMasterStore";

/** Resolve only existing canonical identity. Opening a UI never invents a security or fetches providers. */
export async function bindTerminalArtifactIdentity(content: ArtifactContent): Promise<ArtifactContent> {
  if (content.kind !== "screen") return content;
  const state = readTerminalScreenState(content.state);
  if (!state) return content;
  const symbol = content.symbol?.trim().toUpperCase() || null;
  const resolved = symbol ? await resolvePersistedInstrument({ ticker: symbol }) : null;
  const match = resolved?.status === "resolved" && resolved.match?.canonical ? resolved.match : null;
  return { ...content, symbol, state: { ...content.state, terminal: { ...state, subject: { symbol, securityId: match?.securityId ?? null, listingId: match?.listingId ?? null } } } };
}
