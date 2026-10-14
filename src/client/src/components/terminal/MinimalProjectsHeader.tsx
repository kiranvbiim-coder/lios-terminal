import { LayoutDashboard, Bell, BellOff } from "lucide-react";
import ReferenceBrand from "./ReferenceBrand";
import { useProactivePulse } from "@/lib/useProactivePulse";

interface Props {
  onExpandWorkspace: () => void;
  onOpenPulse: () => void;
  proactivePulseEnabled: boolean;
  onToggleProactivePulse: () => void;
}

/**
 * The deliberately calm Project/chat header shown on the default landing
 * state (experienceSurface === "projects" in Terminal.tsx).
 *
 * Professional depth is a progressive expansion of the same Project,
 * conversation and analytical state -- not a separate "power product".
 * Dense terminal chrome remains available on demand without resetting context.
 */
export default function MinimalProjectsHeader({ onExpandWorkspace, onOpenPulse, proactivePulseEnabled, onToggleProactivePulse }: Props) {
  const pulse = useProactivePulse(proactivePulseEnabled);

  return (
    <div className="lios-reference-titlebar">
      <div className="lios-reference-window-dots" aria-hidden="true"><i /><i /><i /></div>
      <div className="lios-reference-titlebar-brand"><ReferenceBrand /></div>

      <div className="flex items-center gap-2">
        {proactivePulseEnabled && pulse.status === "ready" && pulse.count > 0 && (
          <button
            type="button"
            onClick={onOpenPulse}
            title={`${pulse.count} thing${pulse.count === 1 ? "" : "s"} need attention -- open Pulse`}
            className="flex items-center gap-1.5 border border-red-400/30 bg-red-400/[0.06] px-2 py-1.5 font-terminal text-[12px] font-semibold text-red-300 transition-colors hover:bg-red-400/[0.12]"
          >
            <Bell className="h-3 w-3" />
            {pulse.count}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleProactivePulse}
          title={proactivePulseEnabled ? "Turn off proactive Pulse (ambient nudges)" : "Turn on proactive Pulse -- LiOS will surface what changed and what needs attention, even here"}
          aria-pressed={proactivePulseEnabled}
          className={`flex items-center justify-center border px-1.5 py-1.5 transition-colors ${proactivePulseEnabled ? "border-cyan-400/30 text-cyan-300 hover:bg-cyan-400/[0.08]" : "border-border text-muted-foreground hover:text-foreground"}`}
        >
          {proactivePulseEnabled ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
        </button>

        <button
          type="button"
          onClick={onExpandWorkspace}
          title="Expand this same LiOS workspace into charts, models, screeners and professional analytical panes"
          className="flex items-center gap-1.5 border border-[hsl(38,95%,50%)]/40 bg-[hsl(38,95%,50%)]/[0.06] px-2.5 py-1.5 font-terminal text-[12px] font-semibold tracking-widest text-[hsl(38,95%,60%)] transition-colors hover:bg-[hsl(38,95%,50%)]/[0.12]"
        >
          <LayoutDashboard className="h-3 w-3" />
          WORKSPACE
        </button>


      </div>
    </div>
  );
}


