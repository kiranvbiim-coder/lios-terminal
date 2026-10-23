import type { ViewMode } from "./terminalTypes";
import { TERMINAL_CAPABILITIES, getTerminalCapability } from "./terminalCatalog";
import { isViewVisibleToAudience, type WorkspaceAudience } from "./featureRegistry";

/** Navigation reference to an existing terminal panel; never data or execution authority. */
export interface ChatTerminalContext { view: ViewMode; symbol: string | null; stockTape?: boolean; macroTape?: boolean }
export interface ChatTerminalControls {
  onSymbol: (symbol: string) => void;
  onNav: (view: ViewMode) => void;
}
export function chatTerminalCapabilities(audience: WorkspaceAudience) {
  const shellOnly = new Set(["missioncontrol", "agent", "artifact", "developer", "adminconsole", "consultinginbox", "publishdesk", "environment", "activity", "advisory", "workspaces"]);
  return TERMINAL_CAPABILITIES.filter(item => isViewVisibleToAudience(item.view, audience) && !shellOnly.has(item.view));
}
export function normalizeChatTicker(value: string): string | null {
  const symbol = value.trim().replace(/^\$/, "").toUpperCase();
  return /^[A-Z^][A-Z0-9.^=_-]{0,24}$/.test(symbol) ? symbol : null;
}
const ALIASES: Readonly<Record<string, ViewMode>> = {
  "markets": "market", "market overview": "market", "stock market": "market",
  "price": "quote", "stock price": "quote", "stock quote": "quote", "price chart": "chart",
  "financials": "financialstatements", "financial statements": "financialstatements",
  "fundamentals": "companyfundamentals", "stock screener": "screener", "macro": "macrodashboard",
  "ticker": "quote", "stock ticker": "quote", "peer comparison": "peercomp",
};
/** Only explicit view requests are navigation. Analysis, research and calculation stay in the governed runtime. */
export function parseChatTerminalRequest(message: string, carriedSymbol: string | null, audience: WorkspaceAudience): ChatTerminalContext | null {
  if (/^(?:show|open|display)(?: me)? (?:the )?(?:stock )?ticker(?: tape)?[.!?]?$/i.test(message.trim())) return { view: "market", symbol: carriedSymbol, stockTape: true };
  if (/^(?:show|open|display)(?: me)? (?:the )?macro ticker(?: tape)?[.!?]?$/i.test(message.trim())) return { view: "market", symbol: carriedSymbol, macroTape: true };
  const match = /^(?:please\s+)?(?:show|open|display)(?:\s+me)?\s+(.+?)[.!?]?$/i.exec(message.trim())
    ?? /^\/([a-z]+(?:\s+[^\n]+)?)$/i.exec(message.trim());
  if (!match) return null;
  const body = match[1].replace(/^the\s+/i, "").trim();
  const capabilities = chatTerminalCapabilities(audience);
  const names = new Map<string, ViewMode>(Object.entries(ALIASES));
  for (const item of capabilities) { names.set(item.view.toLowerCase(), item.view); names.set(item.label.toLowerCase(), item.view); }
  for (const [name, view] of [...names].sort((a,b) => b[0].length-a[0].length)) {
    if (!capabilities.some(item => item.view === view)) continue;
    let token: string | null = null;
    const lower = body.toLowerCase();
    if (lower === name) token = "";
    else if (lower.startsWith(`${name} `)) token = body.slice(name.length).replace(/^\s+(?:for|of|on)\s+/i, "").trim();
    else if (lower.endsWith(` ${name}`)) token = body.slice(0, -name.length).trim();
    if (token === null) continue;
    const symbolAware = getTerminalCapability(view).symbolAware;
    if (!symbolAware) { if (!token) return { view, symbol: carriedSymbol }; continue; }
    if (!token || /^(?:its|this stock|this security)$/i.test(token)) return { view, symbol: carriedSymbol };
    // A company name is not a ticker. Leave its resolution to the existing runtime.
    if (!token.startsWith("$") && token !== token.toUpperCase()) continue;
    const symbol = normalizeChatTicker(token);
    if (symbol) return { view, symbol };
  }
  return null;
}
