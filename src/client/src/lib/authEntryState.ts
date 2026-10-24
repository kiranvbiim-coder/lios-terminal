import { restoreSession, type SessionIdentity } from "./sessionLifecycle";

export type AuthEntryAction = "signin" | "register" | "sso";

const LICENSE_DENIALS: Record<string, string> = {
  license_grace_expired: "Your organization's billing grace period has ended. Contact your account administrator to restore access.",
  license_suspended: "This organization's access has been suspended. Contact your account administrator.",
  license_security_locked: "This organization's access has been locked for security reasons. Contact your account administrator.",
  license_terminated: "This organization's license has been terminated. Contact your account administrator.",
};

/** Only server-reported entitlement *codes* select safe UI copy. Never render body.error. */
export function authEntryErrorMessage(action: AuthEntryAction, status: number, reason?: unknown): string {
  if (status === 403 && typeof reason === "string" && LICENSE_DENIALS[reason]) return LICENSE_DENIALS[reason];
  if (status === 429) return "Too many attempts. Wait a moment before trying again.";
  if (status === 401) return action === "signin"
    ? "The email or password was not accepted. Check your details and retry."
    : "Your organization did not approve this sign-in. Check your account and retry.";
  if (status === 409 && action === "register") return "An account with these details may already exist. Try signing in.";
  if (status === 403) return "Access to this organization is restricted. Contact your administrator.";
  if (status >= 500 || status === 0) return "The secure sign-in service is unavailable. Retry when it is reachable.";
  return action === "register"
    ? "Your account could not be created. Check your details and retry."
    : "Sign-in could not be completed. Check your details and retry.";
}

export async function verifiedEntrySession<T extends SessionIdentity>(options: { fetcher?: typeof fetch } = {}): Promise<T> {
  // Only the server's fresh /me identity authorizes an authenticated UI.
  // Login/register/SSO acknowledgement alone must not create local session data.
  const session = await restoreSession<T>("/api/auth/me", options);
  if (!session) throw new Error("Session verification required.");
  return session;
}

export function safeSsoVerificationUrl(input: unknown, allowDevelopmentLoopback = false): string | null {
  if (typeof input !== "string") return null;
  try {
    const url = new URL(input);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const secure = url.protocol === "https:" || (allowDevelopmentLoopback && local && url.protocol === "http:");
    return secure && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** A bounded request even when a fetch adapter does not honor abort signals. */
export async function authEntryFetch(
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; fetcher?: typeof fetch } = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    controller.abort();
    deadline.reject(new Error("Authentication request timed out."));
  }, timeoutMs);
  try {
    return await Promise.race([
      (options.fetcher ?? fetch)(url, { ...init, signal: controller.signal }),
      deadline.promise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
