import { useQuery } from "@tanstack/react-query";
import type { InstallationAccessMode, InstallationAccessReason } from "@shared/commercialRuntime";
import { apiRequest } from "@/lib/queryClient";

/** What the server says about starting new work on this installation (GET /api/license/access). */
export type LicenseAccess = InstallationAccessMode & { isOwner: boolean };

export const LICENSE_ACCESS_KEY = ["/api/license/access"];
export const LICENSE_STATUS_QUERY_KEY = ["/api/license/status"];

export function useLicenseAccess(enabled: boolean) {
  return useQuery<LicenseAccess>({
    queryKey: LICENSE_ACCESS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/license/access")).json(),
    enabled,
    staleTime: 15_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
}

/** True while the server permits this administrator to explicitly start the not-yet-started trial. */
export function needsFirstRunChoice(access: LicenseAccess | undefined): boolean {
  return Boolean(access && access.mode === "read_only" && access.reason === "trial_not_started" && access.canStartTrial);
}

const READ_ONLY_REASON_TEXT: Record<Exclude<InstallationAccessReason, "license_valid" | "trial_active" | "unmanaged">, string> = {
  trial_not_started: "Read-only: choose Start 7-day trial or enter a license key to begin.",
  trial_expired: "Read-only: your 7-day trial has ended. Enter a license key to continue.",
  license_expired: "Read-only: your license key has expired. Enter a new license key to continue.",
  license_unusable: "Read-only: the saved license key can no longer be used. Enter a license key to continue.",
};

/** Banner copy for a read-only installation; null when new work is allowed. */
export function readOnlyBannerText(access: LicenseAccess | undefined): string | null {
  if (!access || access.mode !== "read_only") return null;
  if (access.reason === "license_valid" || access.reason === "trial_active" || access.reason === "unmanaged") return null;
  return READ_ONLY_REASON_TEXT[access.reason];
}

/** Settings status line: what is in force, when it ends and how many days are left. */
export function describeLicenseAccess(access: LicenseAccess | undefined): string {
  if (!access) return "Checking access…";
  const days = (count: number) => `${count} ${count === 1 ? "day" : "days"} left`;
  if (access.mode === "full") {
    if (access.reason === "license_valid") {
      const until = access.licenseExpiresAt ? new Date(access.licenseExpiresAt).toLocaleDateString() : null;
      return `Licensed${until ? ` until ${until}` : ""}${access.daysLeft === null ? "" : ` (${days(access.daysLeft)})`}`;
    }
    if (access.reason === "trial_active") {
      const until = access.trialEndsAt ? new Date(access.trialEndsAt).toLocaleDateString() : null;
      return `Free trial${until ? ` until ${until}` : ""}${access.daysLeft === null ? "" : ` (${days(access.daysLeft)})`}`;
    }
    return "Access active";
  }
  return readOnlyBannerText(access) ?? "Read-only";
}

const MAX_PASTE_CHARS = 65_536;

/** A quick local check before sending; the server's verification is the authority. Null means "send it". */
export function licenseEntryProblem(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "Paste your license key (it starts with LIOS1-).";
  if (trimmed.length > MAX_PASTE_CHARS) return "That is too long to be a LiOS license key.";
  if (!/^LIOS1-/i.test(trimmed) && !trimmed.startsWith("{")) return "A LiOS license key starts with LIOS1-. Paste the whole key.";
  return null;
}
