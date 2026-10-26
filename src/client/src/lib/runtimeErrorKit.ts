/**
 * Plain-language error states for a failed chat run. The server already sanitizes messages; this only
 * decides the title, what the user can do next, and which button to offer. The raw code stays available
 * as small print for support, never as the headline.
 */
export type ErrorKind = "input_required" | "permission" | "ai_provider" | "rate_limit" | "budget" | "network" | "unconfirmed" | "storage" | "unknown";
export type ErrorRecovery = "retry" | "connect";

export interface ErrorPresentation {
  kind: ErrorKind;
  title: string;
  hint: string;
  recoveries: ErrorRecovery[];
}

export function presentRuntimeError(code: string, message: string): ErrorPresentation {
  const text = `${code} ${message}`.toLowerCase();
  // Deterministic finance models are not AI models. Recognize the runtime's input-gap
  // fields/messages before the provider keyword fallback (including failed HTTP requests).
  if (/^(professional_model_inputs|deterministic_engine_inputs)$/.test(code.toLowerCase())
    || /\bstructured_model_inputs_or_active_artifact\b|requires explicit deterministic model inputs|explicit model inputs needed to run it safely are not available/.test(text)) {
    return {
      kind: "input_required",
      title: "This request needs model inputs",
      hint: "Provide the assumptions or model inputs in this chat, or select a saved Valuation, Portfolio or Model Artifact, then send the updated request. Deterministic calculations do not require AI.",
      recoveries: [],
    };
  }
  if (/budget/.test(text)) {
    return { kind: "budget", title: "This request hit its work limit", hint: "Ask for a narrower piece (one company or one metric) and try again.", recoveries: ["retry"] };
  }
  if (/\b429\b|rate.?limit|quota|too many requests|billing/.test(text)) {
    return { kind: "rate_limit", title: "The AI provider is out of quota", hint: "Check the provider's usage or billing, or switch provider on the Connect screen. Deterministic results still work with AI off.", recoveries: ["connect", "retry"] };
  }
  if (/run_interrupted|run_start_unconfirmed|outcome (was )?not confirmed|outcome was confirmed|home restarted/.test(text)) {
    return { kind: "unconfirmed", title: "Run outcome not confirmed", hint: "Check the original Chat run before sending again. Home may have received the request; nothing was retried automatically.", recoveries: [] };
  }
  if (/permission.{0,14}denied|access.?denied|\bforbidden\b|source.{0,30}revoked|entitlement required|not permitted/.test(text)
    && !/provider|api key|model credential/.test(text)) {
    return { kind: "permission", title: "Access was not granted", hint: "The requested source or action is not authorized. Check access in Connections or ask its owner for permission. No approval or result was confirmed.", recoveries: [] };
  }
  if (/api key|unauthori[sz]ed|\b401\b|\b403\b|invalid.*key|provider|model|ai (is|not)|not configured/.test(text)) {
    return { kind: "ai_provider", title: "The AI provider couldn't answer", hint: "Open Connect to check the key and model, then retry.", recoveries: ["connect", "retry"] };
  }
  if (/network|fetch failed|timed? ?out|econn|enotfound|offline|unreachable/.test(text)) {
    return { kind: "network", title: "Couldn't reach a data source", hint: "This looks like a connection problem. Retry in a moment.", recoveries: ["retry"] };
  }
  if (/database|storage|disk|could not save|couldn't save/.test(text)) {
    return { kind: "storage", title: "LiOS could not confirm this save", hint: "Review the original Chat and saved work before trying again. No save success was confirmed.", recoveries: ["retry"] };
  }
  return { kind: "unknown", title: "Something went wrong with this request", hint: "Retry, or rephrase the request.", recoveries: ["retry"] };
}
