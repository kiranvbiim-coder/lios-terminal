import type { GatewayState } from "./gateway/gatewayClient";

export interface ConversationSendAvailability {
  canSubmit: boolean;
  title: string;
  detail: string;
}

/**
 * WS-61: a send may create a Chat, upload staged files, or trigger governed work.
 * Never start one while the Home transport is unconfirmed. Reconnect itself must
 * not replay the draft. Existing read-only and local edit surfaces stay usable.
 */
export function conversationSendAvailability(online: boolean, gatewayState: GatewayState): ConversationSendAvailability {
  if (!online) {
    return {
      canSubmit: false,
      title: "You're offline",
      detail: "Your unsent message and staged files stay in this tab. Nothing will send automatically when your connection returns.",
    };
  }
  if (gatewayState !== "ready") {
    return {
      canSubmit: false,
      title: "LiOS Home isn't connected",
      detail: gatewayState === "failed" || gatewayState === "stopped"
        ? "Your draft and staged files remain in this tab. Use Retry connection, then review the request and press Send. Nothing is resent automatically."
        : gatewayState === "pairing"
          ? "Connection approval is still pending. Your unsent draft remains here and will not be sent automatically."
          : "Your draft remains in this tab. Wait for Home to reconnect, then review it and press Send. No action is replayed automatically.",
    };
  }
  return { canSubmit: true, title: "", detail: "" };
}

/** A transport failure is not proof that the Home never received a run. */
export function unconfirmedRunRecoveryNotice(): string {
  return "The original request is restored for review. Check Chat and run activity before sending again; Home may have received the earlier request. Nothing was retried automatically.";
}
/** Offer an explicit retry only when the gateway has stopped retrying and the browser is online. */
export function canRetryHomeConnection(online: boolean, gatewayState: GatewayState): boolean {
  return online && (gatewayState === "failed" || gatewayState === "stopped");
}
