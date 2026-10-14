/**
 * Plain-language error states for a failed chat run. The server already sanitizes messages; this only
 * decides the title, what the user can do next, and which button to offer. The raw code stays available
 * as small print for support, never as the headline.
 */
export type ErrorKind = "ai_provider" | "rate_limit" | "budget" | "network" | "storage" | "unknown";
export type ErrorRecovery = "retry" | "connect";

export interface ErrorPresentation {
  kind: ErrorKind;
  title: string;
  hint: string;
  recoveries: ErrorRecovery[];
}

export function presentRuntimeError(code: string, message: string): ErrorPresentation {
  const text = `${code} ${message}`.toLowerCase();
  if (/budget/.test(text)) {
    return { kind: "budget", title: "This request hit its work limit", hint: "Ask for a narrower piece (one company or one metric) and try again.", recoveries: ["retry"] };
  }
  if (/\b429\b|rate.?limit|quota|too many requests|billing/.test(text)) {
    return { kind: "rate_limit", title: "The AI provider is out of quota", hint: "Check the provider's usage or billing, or switch provider on the Connect screen. Deterministic results still work with AI off.", recoveries: ["connect", "retry"] };
  }
  if (/api key|unauthori[sz]ed|\b401\b|\b403\b|invalid.*key|provider|model|ai (is|not)|not configured/.test(text)) {
    return { kind: "ai_provider", title: "The AI provider couldn't answer", hint: "Open Connect to check the key and model, then retry.", recoveries: ["connect", "retry"] };
  }
  if (/network|fetch failed|timed? ?out|econn|enotfound|offline|unreachable/.test(text)) {
    return { kind: "network", title: "Couldn't reach a data source", hint: "This looks like a connection problem. Retry in a moment.", recoveries: ["retry"] };
  }
  if (/database|storage|disk|could not save|couldn't save/.test(text)) {
    return { kind: "storage", title: "LiOS couldn't save this run", hint: "Nothing was lost from your chat. Retry, and restart LiOS if it keeps happening.", recoveries: ["retry"] };
  }
  return { kind: "unknown", title: "Something went wrong with this request", hint: "Retry, or rephrase the request.", recoveries: ["retry"] };
}
