import { invokeAIRoutedCompletion, AIProviderError } from "./byoaiTransport";
import { isEmailConfigured, sendEmail } from "./emailService";
import { recordConnectorVerification } from "./connectorVerification";
import type { IntelligenceCard } from "@shared/waveDContracts";
import type { NotificationEnvelope } from "@shared/waveDAdvancedContracts";

export interface ContextualAnswer {
  status: "ready" | "unavailable";
  answer?: string;
  provider?: string;
  model?: string;
  attribution?: unknown;
  reason: string;
}

function evidencePrompt(card: IntelligenceCard, question: string): string {
  const evidence = card.evidence.map((item) => ({
    id: item.id,
    source: item.source,
    provider: item.provider ?? null,
    snapshotId: item.snapshotId ?? null,
    availableAt: item.availableAt ?? null,
    url: item.url ?? null,
  }));
  return [
    "Answer the user's question about one LiOS Pulse card.",
    "Use only the card facts and attributed evidence below. Do not invent values, causes, dates, or recommendations.",
    "If the evidence is insufficient, say so explicitly.",
    `Card title: ${card.title}`,
    `What happened: ${card.whatHappened}`,
    `Why it matters: ${card.whyItMatters}`,
    `Why it matters to this user: ${card.whyItMattersToUser}`,
    `Question: ${question}`,
    `Evidence: ${JSON.stringify(evidence)}`,
  ].join("\n");
}

/**
 * Optional provider execution for contextual Pulse questions. The
 * deterministic card/evidence contract remains authoritative; a missing or
 * unavailable AI provider returns an explicit unavailable result.
 */
export async function answerContextualQuestion(card: IntelligenceCard | undefined, question: string): Promise<ContextualAnswer> {
  if (!card || !question.trim()) return { status: "unavailable", reason: "A Pulse card and a non-empty question are required." };
  if (!card.evidence.length) return { status: "unavailable", reason: "No attributed evidence is attached to this card." };
  try {
    const completion = await invokeAIRoutedCompletion({
      messages: [{ role: "user", content: evidencePrompt(card, question.trim()) }],
      maxTokens: 1_200,
    });
    return {
      status: "ready",
      answer: completion.text,
      provider: completion.provider,
      model: completion.model,
      attribution: completion.attribution,
      reason: "Answer generated from the attributed card evidence.",
    };
  } catch (error) {
    const reason = error instanceof AIProviderError ? error.message : "No AI provider could answer this question.";
    return { status: "unavailable", reason };
  }
}

export interface NotificationDispatchResult {
  status: "delivered" | "blocked";
  deliveredAt?: string;
  reason?: string;
}

function allowlistedWebhook(destination: string): URL | null {
  let url: URL;
  try { url = new URL(destination); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  const allowlist = (process.env.WAVE_D_WEBHOOK_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (!allowlist.includes(url.origin.toLowerCase()) && !allowlist.includes(url.host.toLowerCase())) return null;
  return url;
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Delivers only channels whose transport is implemented in this build.
 * OAuth-backed Gmail/Microsoft/Slack/Teams and desktop delivery remain
 * explicit blocked states until their runtime adapters are configured.
 */
export async function dispatchWaveDNotification(notification: NotificationEnvelope, confirmed: boolean): Promise<NotificationDispatchResult> {
  if (!confirmed) return { status: "blocked", reason: "Explicit send confirmation is required." };
  if (!notification.requiresConfirmation) return { status: "blocked", reason: "Notification permission does not allow this delivery." };

  if (notification.channel === "email") {
    if (!notification.destination || !validEmail(notification.destination)) return { status: "blocked", reason: "A valid email destination is required." };
    if (!isEmailConfigured()) return { status: "blocked", reason: "SMTP is not configured. Set SMTP_URL or SMTP_HOST/SMTP_USER/SMTP_PASS." };
    const result = await sendEmail({ to: notification.destination, subject: notification.title, text: notification.body });
    if (result.sent) {
      recordConnectorVerification("communication:smtp", true, "SMTP delivered an explicitly confirmed LiOS notification.");
      return { status: "delivered", deliveredAt: new Date().toISOString() };
    }
    recordConnectorVerification("communication:smtp", false, result.reason ?? "SMTP delivery failed.");
    return { status: "blocked", reason: result.reason ?? "SMTP delivery failed." };
  }

  if (notification.channel === "webhook") {
    if (!notification.destination) return { status: "blocked", reason: "A webhook destination is required." };
    const url = allowlistedWebhook(notification.destination);
    if (!url) return { status: "blocked", reason: "Webhook destination must be HTTPS and match WAVE_D_WEBHOOK_ALLOWLIST." };
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: notification.id, title: notification.title, body: notification.body, evidenceIds: notification.evidenceIds, createdAt: notification.createdAt }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const reason = `Webhook returned HTTP ${response.status}.`;
        recordConnectorVerification("communication:webhook", false, reason);
        return { status: "blocked", reason };
      }
      recordConnectorVerification("communication:webhook", true, "Allow-listed HTTPS webhook delivered an explicitly confirmed LiOS notification.");
      return { status: "delivered", deliveredAt: new Date().toISOString() };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Webhook delivery failed.";
      recordConnectorVerification("communication:webhook", false, reason);
      return { status: "blocked", reason };
    }
  }

  return { status: "blocked", reason: `${notification.channel} delivery requires its provider adapter and authorization.` };
}
