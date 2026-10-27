/**
 * Adapted from Kibo UI (shadcnblocks/kibo), packages/status/index.tsx.
 * Source commit: 3d63cdb15b79d972e3dc38a10997987672f9b263 (MIT).
 * Retains Kibo's compound Status/StatusIndicator/StatusLabel interface.
 * Local adaptations: Tailwind 3 support, reduced decorative motion, focus on true state.
 * See ./LICENSE and docs/technical/LIOS_UI_TWO_DONOR_IMPLEMENTATION_2026-10-27.md.
 */
import type { ComponentProps, HTMLAttributes } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type KiboStatus = "online" | "offline" | "maintenance" | "degraded";

export type StatusProps = ComponentProps<typeof Badge> & {
  status: KiboStatus;
};

export const Status = ({ className, status, ...props }: StatusProps) => (
  <Badge
    variant="outline"
    data-kibo-status={status}
    className={cn(
      "group inline-flex items-center gap-1.5 rounded-md border-border/65 bg-white/[0.025] px-2 py-0.5 font-terminal text-[10px] font-medium uppercase tracking-wide",
      status,
      className,
    )}
    {...props}
  />
);

export type StatusIndicatorProps = HTMLAttributes<HTMLSpanElement>;

export const StatusIndicator = ({ className, ...props }: StatusIndicatorProps) => (
  <span aria-hidden="true" className={cn("relative inline-flex h-2 w-2 shrink-0", className)} {...props}>
    <span className="absolute inset-0 rounded-full bg-emerald-400/70 opacity-0 motion-safe:group-[.online]:animate-ping group-[.online]:opacity-70" />
    <span className={cn(
      "relative inline-flex h-2 w-2 rounded-full bg-slate-500",
      "group-[.online]:bg-emerald-400 group-[.offline]:bg-slate-500",
      "group-[.maintenance]:bg-blue-400 group-[.degraded]:bg-amber-400",
    )} />
  </span>
);

export type StatusLabelProps = HTMLAttributes<HTMLSpanElement>;

export const StatusLabel = ({ className, children, ...props }: StatusLabelProps) => (
  <span className={cn("text-muted-foreground", className)} {...props}>
    {children ?? (
      <>
        <span className="hidden group-[.online]:block">Online</span>
        <span className="hidden group-[.offline]:block">Offline</span>
        <span className="hidden group-[.maintenance]:block">Maintenance</span>
        <span className="hidden group-[.degraded]:block">Degraded</span>
      </>
    )}
  </span>
);
