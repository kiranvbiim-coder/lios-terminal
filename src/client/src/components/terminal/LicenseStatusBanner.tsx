/**
 * LV4-02-08: surfaces a degraded-license warning inside the terminal shell.
 *
 * Online commercial warnings use "license_in_grace" and
 * "license_billing_hold". P1B also reuses this compact shell banner for
 * "offline_lease_authorized" so signed degraded-mode access is explicit.
 * Other blocking license reasons
 * (grace_expired, suspended, security_locked, terminated) already fails
 * login itself (see controlPlanePolicy.ts's evaluateLicenseLifecycle:
 * canAuthenticate is false for those), so a session carrying this banner's
 * props never exists in the first place for them. Login.tsx surfaces those
 * at the point they actually happen -- the login attempt.
 *
 * "billing_hold" in particular authenticates fine but has
 * canUseEntitledFeatures = false, so without this banner a client would
 * otherwise discover something is wrong only by hitting a wall of
 * unexplained 403s on feature routes.
 *
 * Deliberately no "Update Payment Method" button -- V4-03 (the billing
 * control plane / provider integration) doesn't exist yet, so there is no
 * real self-service destination to send anyone to. "Contact your account
 * administrator" is the one true recourse available today; fabricating a
 * button that goes nowhere would be worse than no button.
 */
import { useState } from "react";

export type LicenseBannerReason = "license_in_grace" | "license_billing_hold" | "offline_lease_authorized";

interface LicenseStatusBannerProps {
  reason: LicenseBannerReason;
  graceEndsAt: string | null;
}

function daysRemaining(graceEndsAt: string | null): number | null {
  if (!graceEndsAt) return null;
  const end = new Date(graceEndsAt).getTime();
  if (!Number.isFinite(end)) return null;
  const diffMs = end - Date.now();
  return diffMs > 0 ? Math.ceil(diffMs / (24 * 60 * 60 * 1000)) : 0;
}

export default function LicenseStatusBanner({ reason, graceEndsAt }: LicenseStatusBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const remaining = reason === "license_in_grace" ? daysRemaining(graceEndsAt) : null;
  const message = reason === "license_in_grace"
    ? remaining !== null
      ? `Billing is past due. Access continues in a grace period for ${remaining} more day${remaining === 1 ? "" : "s"}.`
      : "Billing is past due. Access continues in a grace period."
    : reason === "offline_lease_authorized"
      ? "LiOS is offline. Signed device-bound entitlements are active; connected/web capabilities may be unavailable until the control plane reconnects."
      : "Billing is on hold. Some features are restricted until this is resolved.";

  return (
    <div
      data-testid="license-status-banner"
      className="flex items-center gap-3 border-b px-4 py-1.5 font-terminal text-xs"
      style={{
        background: "hsl(0 75% 50% / 12%)",
        borderColor: "hsl(0 75% 50% / 30%)",
      }}
    >
      <span className="text-[hsl(0,75%,62%)]">{message}</span>
      <span className="ml-auto text-muted-foreground">
        {reason === "offline_lease_authorized" ? "Working from the verified offline lease." : "Contact your account administrator."}
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
