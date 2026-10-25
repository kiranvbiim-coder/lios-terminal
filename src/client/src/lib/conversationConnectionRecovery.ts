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
      detail: "Your draft remains in this tab. Wait for Home to reconnect, then review it and press Send. No action is replayed automatically.",
    };
  }
  return { canSubmit: true, title: "", detail: "" };
}

/** A transport failure is not proof that the Home never received a run. */
export function unconfirmedRunRecoveryNotice(): string {
  return "The original request is restored for review. Check Chat and run activity before sending again; Home may have received the earlier request. Nothing was retried automatically.";
}
