import * as React from "react";
import { normalizePulseSubject, type PulseSubjectChoice } from "@shared/pulseSubjectPreferences";

/** Reusable explicit controls; presentation only. The owner confirms writes. */
export function PulseSubjectActions({
  subjectKey, choice, busy = false, onChange,
}: {
  subjectKey?: string;
  choice?: PulseSubjectChoice | null;
  busy?: boolean;
  onChange?: (subject: string, choice: PulseSubjectChoice) => void;
}) {
  const subject = normalizePulseSubject(subjectKey);
  if (!subject || !onChange) return null;
  return <>
    <button type="button" disabled={busy}
      aria-pressed={choice === "follow"}
      onClick={() => onChange(subject, choice === "follow" ? "clear" : "follow")}
      className="min-h-10 rounded-lg border border-border/70 px-3 py-2 font-ui text-sm font-medium text-foreground hover:border-amber-300/40 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-amber-300/70">
      {choice === "follow" ? "Unfollow" : "Follow"} {subject}
    </button>
    <button type="button" disabled={busy}
      aria-pressed={choice === "mute"}
      onClick={() => onChange(subject, choice === "mute" ? "clear" : "mute")}
      className="min-h-10 rounded-lg border border-border/70 px-3 py-2 font-ui text-sm font-medium text-foreground hover:border-amber-300/40 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-amber-300/70">
      {choice === "mute" ? "Unmute" : "Mute"} {subject}
    </button>
  </>;
}
