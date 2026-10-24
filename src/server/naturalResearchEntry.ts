/** WS-26: narrow, deterministic entry for explicit plain-language research requests.
 * This is intent detection, not evidence retrieval or permission to browse.
 */
export interface NaturalResearchEntry {
  objective: string;
}

const RESEARCH_ENTRY = /^(?:(?:(?:can|could|would)\s+you\s+)?please\s+|(?:can|could|would)\s+you\s+)?(?:research|investigate|look\s+into|do\s+a\s+deep\s+dive\s+(?:into|on)|prepare\s+(?:a\s+)?research\s+brief\s+(?:on|about)|find\s+(?:credible|reliable|primary)\s+sources\s+(?:on|about|for))\s+(.+)$/i;

export function naturalResearchEntry(message: string): NaturalResearchEntry | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length < 12 || normalized.length > 600 || normalized.startsWith("/")) return null;
  const match = RESEARCH_ENTRY.exec(normalized);
  if (!match) return null;
  const objective = match[1].replace(/^(?:on|about|into)\s+/i, "").replace(/[?.!]+$/, "").trim();
  if (objective.length < 3 || objective.length > 400) return null;
  if (/^(?:this|that|it|more|further|everything|anything|something|research|sources|the topic)$/i.test(objective)) return null;
  return { objective };
}
