/** Keep transient service failures distinct from an explicitly expired session. */
export interface SessionIdentity {
  email: string;
  role: string;
  name: string;
  mustChangePassword: boolean;
}

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

async function withSessionDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: RequestOptions,
): Promise<T> {
  // Use a private signal for network operations. AbortSignal.any would copy
  // options.signal.reason (possibly a credential) onto the fetch signal.
  const controller = new AbortController();
  const signal = controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let onExternalAbort: (() => void) | undefined;
  let timedOut = false;
  try {
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => {
        if (timedOut) {
          reject(new Error("LiOS took too long to respond. Please retry."));
          return;
        }
        const error = new Error("Session request cancelled.");
        error.name = "AbortError";
        reject(error);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      // Never read, forward or log the caller's AbortSignal.reason.
      onExternalAbort = () => controller.abort();
      if (options.signal) {
        if (options.signal.aborted) {
          onExternalAbort();
          return;
        }
        options.signal.addEventListener("abort", onExternalAbort, { once: true });
        // Cover a cancellation racing listener registration.
        if (options.signal.aborted) {
          onExternalAbort();
          return;
        }
      }
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs ?? 15_000);
    });
    if (signal.aborted) return await interrupted;
    return await Promise.race([operation(signal), interrupted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    if (onExternalAbort) options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function restoreSession<T extends SessionIdentity>(url: string, options: RequestOptions = {}): Promise<T | null> {
  return withSessionDeadline(async (signal) => {
    const response = await (options.fetcher ?? fetch)(url, { signal });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error("LiOS couldn't restore your session. Please retry.");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object"
      || typeof (data as SessionIdentity).email !== "string"
      || typeof (data as SessionIdentity).role !== "string"
      || typeof (data as SessionIdentity).name !== "string"
      || typeof (data as SessionIdentity).mustChangePassword !== "boolean") {
      throw new Error("LiOS received an incomplete session response. Please retry.");
    }
    return data as T;
  }, options);
}

export async function signOutSession(url: string, options: RequestOptions = {}): Promise<void> {
  return withSessionDeadline(async (signal) => {
    const response = await (options.fetcher ?? fetch)(url, { method: "POST", signal });
    if (!response.ok && response.status !== 401) {
      throw new Error("LiOS couldn't confirm sign-out. Please retry before leaving this device.");
    }
  }, options);
}
