import { useSyncExternalStore } from "react";

export type Audience = "internal" | "client";

/** Runtime audience: `client_*` roles get the customer experience, everything else internal. */
export function audienceForRole(role: string | null | undefined): Audience {
  return typeof role === "string" && role.startsWith("client_") ? "client" : "internal";
}

let current: Audience = "internal";
const listeners = new Set<() => void>();

export function getAudience(): Audience {
  return current;
}

export function setAudienceFromRole(role: string | null | undefined): void {
  const next = audienceForRole(role);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeAudience(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAudience(): Audience {
  return useSyncExternalStore(subscribeAudience, getAudience, getAudience);
}
