import {
  PERSONA_IDS,
  PERSONA_REGISTRY,
  getPersonaProfile,
  isPersonaId,
  type PersonaId,
  type PersonaProfile,
} from "@shared/personaRegistry";

/** IDs retained for existing terminal state, URLs, and local preferences. */
export const TERMINAL_PERSONA_ALIASES = {
  investor: "buy_side_pm",
  "equity-analyst": "equity_research",
  "portfolio-manager": "portfolio_risk",
  consultant: "corporate_strategy",
  "finance-leader": "executive_decision_maker",
  "policy-researcher": "macro_economics",
  operations: "research_operations",
  sustainability: "corporate_strategy",
} as const satisfies Record<string, PersonaId>;

export type LegacyTerminalPersonaId = keyof typeof TERMINAL_PERSONA_ALIASES;
export type TerminalPersonaId = PersonaId | LegacyTerminalPersonaId;

export interface TerminalPersonaProfile extends Omit<PersonaProfile, "id"> {
  /** The requested ID, which may be a legacy alias. */
  id: TerminalPersonaId;
  /** Canonical ID used for persistence and all new integrations. */
  canonicalId: PersonaId;
  /** Set only when `id` is a legacy compatibility alias. */
  aliasOf?: PersonaId;
}
export type TerminalPersona = TerminalPersonaProfile;


function canonicalProfile(id: PersonaId): TerminalPersonaProfile {
  return { ...PERSONA_REGISTRY[id], canonicalId: id };
}

function aliasProfile(id: LegacyTerminalPersonaId): TerminalPersonaProfile {
  const canonicalId = TERMINAL_PERSONA_ALIASES[id];
  return { ...PERSONA_REGISTRY[canonicalId], id, canonicalId, aliasOf: canonicalId };
}

/** Registry keyed by both canonical IDs and explicitly supported legacy IDs. */
export const TERMINAL_PERSONAS: Record<TerminalPersonaId, TerminalPersonaProfile> = {
  ...Object.fromEntries(PERSONA_IDS.map((id) => [id, canonicalProfile(id)])),
  ...Object.fromEntries(Object.keys(TERMINAL_PERSONA_ALIASES).map((id) => [id, aliasProfile(id as LegacyTerminalPersonaId)])),
} as Record<TerminalPersonaId, TerminalPersonaProfile>;

// Compatibility names for consumers that used the adapter's registry directly.
export const terminalPersonaRegistry = TERMINAL_PERSONAS;
export const terminalPersonas = TERMINAL_PERSONAS;
export const DEFAULT_TERMINAL_PERSONA_ID: PersonaId = "general";
export const DEFAULT_PERSONA_ID = DEFAULT_TERMINAL_PERSONA_ID;

/** Resolve canonical IDs without ever interpreting a persona as authorization. */
export function resolveTerminalPersonaId(id: string | null | undefined): PersonaId {
  if (id && isPersonaId(id)) return id;
  if (id && Object.prototype.hasOwnProperty.call(TERMINAL_PERSONA_ALIASES, id)) {
    return TERMINAL_PERSONA_ALIASES[id as LegacyTerminalPersonaId];
  }
  return DEFAULT_TERMINAL_PERSONA_ID;
}

export const resolvePersonaId = resolveTerminalPersonaId;
export const normalizePersonaId = resolveTerminalPersonaId;

export function getTerminalPersona(id?: string | null): TerminalPersonaProfile {
  if (id && Object.prototype.hasOwnProperty.call(TERMINAL_PERSONAS, id)) {
    return TERMINAL_PERSONAS[id as TerminalPersonaId];
  }
  return TERMINAL_PERSONAS[DEFAULT_TERMINAL_PERSONA_ID];
}

export const getPersona = getTerminalPersona;
export const loadTerminalPersona = getTerminalPersona;


/** Canonical lookup for code that does not need legacy metadata. */
export function getCanonicalPersona(id: string | null | undefined): PersonaProfile {
  return getPersonaProfile(resolveTerminalPersonaId(id)) ?? PERSONA_REGISTRY[DEFAULT_TERMINAL_PERSONA_ID];
}

/** Build a concrete, persona-specific research question without creating data. */
export function deriveResearchStarterQuestion(personaId: string | null | undefined, activeSymbol?: string | null): string {
  const persona = getTerminalPersona(resolveTerminalPersonaId(personaId));
  const symbol = activeSymbol?.trim().toUpperCase() || "";
  const subject = symbol ? ` for ${symbol}` : "";
  switch (persona.canonicalId) {
    case "buy_side_pm":
      return `What evidence should inform an investment decision${subject}, including catalysts, downside risks, and conditions for changing the thesis?`;
    case "equity_research":
    case "sell_side_research":
      return `What evidence supports or challenges the current view${subject}, and what developments could change the thesis?`;
    case "portfolio_risk":
      return `What evidence could change the risk outlook${subject}, including concentration, exposure, and downside triggers?`;
    case "quant_analyst":
      return `Which evidence and assumptions should be validated before relying on a quantitative view${subject}?`;
    case "macro_economics":
      return `What macroeconomic evidence could affect${subject || " the current market view"}, and which policy or data signals matter next?`;
    case "compliance_governance":
      return `What source-backed evidence and control considerations should be reviewed${subject}?`;
    case "research_operations":
      return `Which sources and provenance checks are needed to establish a reliable research record${subject}?`;
    case "executive_decision_maker":
      return `What evidence matters most for the next decision${subject}, and what risks would change the recommended action?`;
    case "investment_banking":
      return `What evidence should anchor diligence and decision analysis${subject}, including material risks and valuation considerations?`;
    case "corporate_strategy":
      return `What evidence should inform the strategic options${subject}, including market shifts, competitors, and execution risks?`;
    case "trader_execution":
      return `What current evidence matters for market context and execution risk${subject}?`;
    default:
      return `What evidence should inform the current research question${subject}, and what could change the conclusion?`;
  }
}
