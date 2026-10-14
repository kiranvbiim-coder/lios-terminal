export interface MarketStatus {
  label: "WEEKEND" | "PRE-MKT" | "MKT OPEN" | "AFTER-HRS" | "CLOSED";
  color: string;
  pulse: boolean;
}

interface ShortcutTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

function getEasternParts(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return { weekday, hour, minute };
}

export function getMarketStatus(now = new Date()): MarketStatus {
  const { weekday, hour, minute } = getEasternParts(now);
  const t = hour * 60 + minute;
  if (weekday === "Sat" || weekday === "Sun") {
    return { label: "WEEKEND", color: "text-muted-foreground", pulse: false };
  }
  if (t >= 240 && t < 570) return { label: "PRE-MKT", color: "text-[hsl(38,95%,55%)]", pulse: true };
  if (t >= 570 && t < 960) return { label: "MKT OPEN", color: "text-up", pulse: true };
  if (t >= 960 && t < 1200) return { label: "AFTER-HRS", color: "text-[hsl(38,95%,55%)]", pulse: true };
  return { label: "CLOSED", color: "text-muted-foreground", pulse: false };
}

export function shouldIgnoreCommandShortcut(target: EventTarget | ShortcutTargetLike | null): boolean {
  if (!target || typeof target !== "object") return false;
  const candidate = target as ShortcutTargetLike;
  return candidate.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(candidate.tagName ?? "");
}

export type WorkspaceShortcutAction = "focus-primary" | "focus-secondary" | "toggle-maximize" | "close-secondary";

export function getWorkspaceShortcutAction(event: Pick<KeyboardEvent, "altKey" | "key" | "target">): WorkspaceShortcutAction | null {
  if (!event.altKey || shouldIgnoreCommandShortcut(event.target)) return null;
  if (event.key === "1") return "focus-primary";
  if (event.key === "2") return "focus-secondary";
  if (event.key === "Enter") return "toggle-maximize";
  if (event.key === "Backspace") return "close-secondary";
  return null;
}
