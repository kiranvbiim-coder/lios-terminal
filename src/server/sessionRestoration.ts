import {
  authSessionStateSchema,
  principalFromUser,
  type AuthSessionState,
} from "@shared/identityContracts";
import type { User } from "@shared/schema";

export interface SessionRestorationInput {
  authenticated: boolean;
  user?: Pick<User, "id" | "email" | "name" | "role" | "organizationId"> | null;
  offline?: boolean;
  forceReauth?: boolean;
  revoked?: boolean;
  reason?: string | null;
  now?: Date;
}

export function resolveSessionRestoration(input: SessionRestorationInput): AuthSessionState {
  const now = input.now ?? new Date();
  if (!input.authenticated || !input.user) {
    return authSessionStateSchema.parse({
      version: 1,
      state: "signed_out",
      principal: null,
      restoredAt: null,
      reason: input.reason ?? "no_session",
    });
  }

  const principal = principalFromUser(input.user);
  if (input.revoked) {
    return authSessionStateSchema.parse({
      version: 1,
      state: "revoked",
      principal,
      restoredAt: now.toISOString(),
      reason: input.reason ?? "session_revoked",
    });
  }
  if (input.forceReauth) {
    return authSessionStateSchema.parse({
      version: 1,
      state: "reauth_required",
      principal,
      restoredAt: now.toISOString(),
      reason: input.reason ?? "session_reauthentication_required",
    });
  }
  return authSessionStateSchema.parse({
    version: 1,
    state: input.offline ? "authenticated_offline" : "authenticated_online",
    principal,
    restoredAt: now.toISOString(),
    reason: input.offline ? (input.reason ?? "offline_lease_authorized") : null,
  });
}
