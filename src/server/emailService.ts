import nodemailer, { type Transporter } from "nodemailer";

/**
 * Notification/email infrastructure (Phase 5) -- confirmed completely
 * absent from this codebase before this file (nodemailer was listed in
 * script/build.ts's bundling allowlist but never actually installed or
 * used anywhere; see the git history of trialAccess.ts's tier-selection
 * route for the exact comment noting the gap). This is the one place that
 * ever talks to an SMTP server, mirroring the FRED/Gemini/Finnhub pattern
 * already used throughout this codebase for optional external services:
 * configured via env vars, and a safe no-op (logged, not thrown) when
 * they're absent -- so a caller can fire a notification unconditionally
 * without checking whether email is configured first.
 *
 * SMTP_URL is the simplest single-var form nodemailer accepts directly
 * (e.g. "smtps://user:pass@smtp.example.com:465"); SMTP_HOST/PORT/USER/
 * PASS/SECURE are the discrete alternative for providers that don't hand
 * out a single connection string. Either is enough to configure this.
 */
export interface SendEmailInput {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

export interface SendEmailResult {
  sent: boolean;
  reason?: string;
}

let cachedTransporter: Transporter | null | undefined;

function buildTransporter(): Transporter | null {
  if (cachedTransporter !== undefined) return cachedTransporter;

  const url = process.env.SMTP_URL;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;

  if (url) {
    cachedTransporter = nodemailer.createTransport(url);
  } else if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    cachedTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT ? Number(SMTP_PORT) : 587,
      secure: SMTP_SECURE === "true",
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  } else {
    cachedTransporter = null;
  }
  return cachedTransporter;
}

export function isEmailConfigured(): boolean {
  return buildTransporter() !== null;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const transporter = buildTransporter();
  if (!transporter) {
    console.log(`[emailService] SMTP not configured -- would have sent "${input.subject}" to ${Array.isArray(input.to) ? input.to.join(", ") : input.to}`);
    return { sent: false, reason: "SMTP not configured" };
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "Limuria Intelligence <noreply@limuria.com>",
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { sent: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown SMTP error";
    console.error(`[emailService] Send failed for "${input.subject}":`, reason);
    return { sent: false, reason };
  }
}
