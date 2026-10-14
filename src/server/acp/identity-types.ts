// Imported from OpenClaw packages/acp-core/src/types.ts (MIT, Copyright (c) 2026 OpenClaw Foundation).
// Pin: c074824a27c96d3983043f9eeb33823cd1772d8c. Identity fields only; no donor session store.
export type SessionAcpIdentitySource = "ensure" | "status" | "event";

export type SessionAcpIdentityState = "pending" | "resolved";

export type SessionAcpIdentity = {
  /** Pending identities may expose provisional ids; resolved identities are safe for resume output. */
  state: SessionAcpIdentityState;
  acpxRecordId?: string;
  acpxSessionId?: string;
  agentSessionId?: string;
  /** Runtime lifecycle point that last supplied the identity fields. */
  source: SessionAcpIdentitySource;
  lastUpdatedAt: number;
};

