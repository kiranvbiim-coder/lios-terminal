import { z } from "zod";
import { requestPinned, resolvePinnedPublicAddress } from "./p13PluginNetworkBroker";

// Selected OpenClaw getUpdates deadline/body bounds at c074824a; no donor host/client is loaded.
const POLL_DEADLINE_MS = 45_000;
const MAX_POLL_BODY_BYTES = 4 * 1024 * 1024;
const pollSchema = z.object({
  // Negative Telegram offsets discard older updates; they are not a polling/recovery operation.
  offset: z.number().int().nonnegative().safe(),
  limit: z.number().int().min(1).max(100).default(100),
  timeoutSeconds: z.number().int().min(0).max(40).default(30),
  allowedUpdates: z.array(z.string().regex(/^[a-z][a-z_]{0,63}$/)).min(1).max(64),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.allowedUpdates).size !== value.allowedUpdates.length) {
    ctx.addIssue({ code: "custom", path: ["allowedUpdates"], message: "Update types must be unique." });
  }
});
export type TelegramPollRequest = z.input<typeof pollSchema>;
type AdmittedPoll = Readonly<Omit<z.output<typeof pollSchema>, "allowedUpdates"> & { allowedUpdates: readonly string[] }>;

export class TelegramPollRefusal extends Error {
  constructor(readonly code: "invalid_request" | "unauthorized" | "cancelled" | "timeout" | "response_too_large" | "unavailable") {
    super(`Telegram polling refused: ${code}.`);
    this.name = "TelegramPollRefusal";
  }
}

/**
 * Internal Home-only network operation. No URL, method, credential or headers come from the worker.
 * Callbacks must resolve current canonical owner/account/credential authority, not a cached worker grant.
 * HTTP acceptance is not durable update adoption; the canonical cursor must advance separately after commit.
 */
export async function requestTelegramGetUpdates(input: {
  poll: TelegramPollRequest;
  signal?: AbortSignal;
  assertAuthorized(poll: AdmittedPoll, signal: AbortSignal): void | Promise<void>;
  resolveBotToken(signal: AbortSignal): string | Promise<string>;
  /** Trusted server test seams only; never populate from a model, worker, HTTP request or saved config. */
  dependencies?: {
    resolveAddress?: typeof resolvePinnedPublicAddress;
    requester?: typeof requestPinned;
  };
}): Promise<{ status: number; body: Buffer }> {
  const parsed = pollSchema.safeParse(input.poll);
  if (!parsed.success) throw new TelegramPollRefusal("invalid_request");
  const poll: AdmittedPoll = Object.freeze({ ...parsed.data, allowedUpdates: Object.freeze(parsed.data.allowedUpdates) });
  const assertAuthorized = input.assertAuthorized;
  const sourceSignal = input.signal;
  const resolveBotToken = input.resolveBotToken;
  const resolveAddress = input.dependencies?.resolveAddress ?? resolvePinnedPublicAddress;
  const requester = input.dependencies?.requester ?? requestPinned;
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, POLL_DEADLINE_MS);
  sourceSignal?.addEventListener("abort", onAbort, { once: true });
  if (sourceSignal?.aborted) onAbort();
  const signal = controller.signal;
  let removeCancellation: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    const rejectAbort = () => reject(new TelegramPollRefusal(timedOut ? "timeout" : "cancelled"));
    signal.addEventListener("abort", rejectAbort, { once: true });
    removeCancellation = () => signal.removeEventListener("abort", rejectAbort);
    if (signal.aborted) rejectAbort();
  });
  const authorized = async () => {
    signal.throwIfAborted();
    try { await assertAuthorized(poll, signal); } catch { throw new TelegramPollRefusal("unauthorized"); }
    signal.throwIfAborted();
  };
  try {
    return await Promise.race([cancelled, (async () => {
      await authorized();
      const pinned = await resolveAddress("api.telegram.org");
      await authorized();
      const token = await resolveBotToken(signal);
      signal.throwIfAborted();
      // A token may only occupy its one fixed path segment; it cannot change host/method/query.
      if (typeof token !== "string" || !/^[0-9]{1,20}:[A-Za-z0-9_-]{1,256}$/.test(token)) {
        throw new TelegramPollRefusal("unauthorized");
      }
      await authorized();
      const response = await requester({
        url: new URL(`https://api.telegram.org/bot${token}/getUpdates`),
        address: pinned.address, family: pinned.family, method: "POST",
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ offset: poll.offset, limit: poll.limit, timeout: poll.timeoutSeconds, allowed_updates: poll.allowedUpdates })),
        timeoutMs: POLL_DEADLINE_MS, maxResponseBytes: MAX_POLL_BODY_BYTES, signal,
      });
      await authorized();
      // Defend the internal requester seam as well as the real bounded P13 transport.
      if (response.body.byteLength > MAX_POLL_BODY_BYTES) throw new TelegramPollRefusal("response_too_large");
      return { status: response.status, body: response.body };
    })()]);
  } catch (error) {
    if (signal.aborted) throw new TelegramPollRefusal(timedOut ? "timeout" : "cancelled");
    if (error instanceof TelegramPollRefusal) throw error;
    if (error instanceof Error && error.message === "network_response_too_large") throw new TelegramPollRefusal("response_too_large");
    // Never retain a token-bearing provider URL, raw error, caller abort reason or cause.
    throw new TelegramPollRefusal("unavailable");
  } finally {
    clearTimeout(timer);
    sourceSignal?.removeEventListener("abort", onAbort);
    removeCancellation?.();
    controller.abort();
  }
}
