import { Eye, Focus, MoonStar, MonitorPlay, Settings2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ThemeSwitcher from "./ThemeSwitcher";
import {
  patchTerminalUxPreferences, saveTerminalUxPreferences,
  type TerminalUxPreferences,
} from "@/lib/terminalUxPreferences";

interface Props {
  preferences: TerminalUxPreferences;
  onChange: (preferences: TerminalUxPreferences) => void;
  onClose: () => void;
}

interface ToggleProps {
  checked: boolean;
  label: string;
  description: string;
  onChange: (value: boolean) => void;
  shortcut?: string;
}

/** A real checkbox inside a full-target label remains accessible via keyboard and AT. */
function Toggle({ checked, label, description, onChange, shortcut }: ToggleProps) {
  return (
    <label className="group flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border border-border/70 bg-white/[0.012] p-3 font-ui transition-colors hover:border-border hover:bg-white/[0.03] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
      <span aria-hidden="true" className={`flex h-6 w-11 shrink-0 items-center rounded-full border p-0.5 transition-colors ${checked ? "border-primary/45 bg-primary/20" : "border-border bg-black/30"}`}>
        <span className={`h-4 w-4 rounded-full transition-transform ${checked ? "translate-x-5 bg-primary" : "translate-x-0 bg-muted-foreground/70"}`} />
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
      <span className="min-w-0 flex-1">
        <span className="block font-ui text-sm font-semibold leading-5 text-foreground">{label}</span>
        <span className="mt-1 block font-ui text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
      {shortcut && <kbd aria-label={`Keyboard shortcut ${shortcut}`} className="hidden shrink-0 rounded-md border border-border/70 px-2 py-1 font-mono text-xs text-muted-foreground sm:inline-block">{shortcut}</kbd>}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 font-ui text-sm font-semibold text-foreground">{children}</h3>;
}

const optionClass = (selected: boolean) => `min-h-11 rounded-lg border px-3 py-2.5 font-ui text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${selected ? "border-primary/50 bg-primary/[0.075] text-primary" : "border-border/70 bg-white/[0.015] text-muted-foreground hover:border-border hover:bg-white/[0.035] hover:text-foreground"}`;

export default function TerminalUxSettings({ preferences, onChange, onClose }: Props) {
  const update = (patch: Partial<TerminalUxPreferences>) => {
    const next = patchTerminalUxPreferences(preferences, patch);
    saveTerminalUxPreferences(next);
    onChange(next);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="lios-v4-overlay flex h-[min(90dvh,860px)] w-[calc(100vw-24px)] max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl border-border bg-[#090909] p-0 text-foreground shadow-2xl">
        <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-4 pr-14 text-left sm:px-5">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.06] text-primary">
              <Settings2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="font-ui text-xl font-semibold tracking-tight">Experience &amp; Comfort</DialogTitle>
              <DialogDescription className="mt-1 font-ui text-sm leading-6 text-muted-foreground">
                Adjust LiOS for focused analysis, meetings and long sessions. These preferences do not change permissions or calculations.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain p-4 scrollbar-thin sm:p-5">
          <section aria-label="Experience mode">
            <SectionTitle>Experience mode</SectionTitle>
            <div role="group" aria-label="Experience mode" className="grid gap-3 sm:grid-cols-2">
              <button type="button" aria-pressed={preferences.experienceMode === "guided"}
                onClick={() => update({ experienceMode: "guided", density: preferences.density === "terminal" || preferences.density === "compact" ? "standard" : preferences.density })}
                className={`min-h-28 rounded-xl border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${preferences.experienceMode === "guided" ? "border-primary/50 bg-primary/[0.06]" : "border-border/70 bg-white/[0.015] hover:border-border hover:bg-white/[0.03]"}`}>
                <Eye className="h-5 w-5 text-primary" aria-hidden="true" />
                <span className="mt-3 block font-ui text-base font-semibold text-foreground">Guided</span>
                <span className="mt-1 block font-ui text-xs leading-5 text-muted-foreground">More explanation, larger targets and prompts, with every capability still available.</span>
              </button>
              <button type="button" aria-pressed={preferences.experienceMode === "professional"}
                onClick={() => update({ experienceMode: "professional" })}
                className={`min-h-28 rounded-xl border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${preferences.experienceMode === "professional" ? "border-primary/50 bg-primary/[0.06]" : "border-border/70 bg-white/[0.015] hover:border-border hover:bg-white/[0.03]"}`}>
                <Focus className="h-5 w-5 text-primary" aria-hidden="true" />
                <span className="mt-3 block font-ui text-base font-semibold text-foreground">Professional</span>
                <span className="mt-1 block font-ui text-xs leading-5 text-muted-foreground">Dense analytical context, terminal commands, keyboard-first controls and flexible layouts.</span>
              </button>
            </div>
          </section>

          <section aria-label="Long-session visual comfort">
            <SectionTitle>Long-session visual comfort</SectionTitle>
            <div className="grid gap-2">
              <Toggle checked={preferences.comfortMode} label="Comfort mode" description="Reduce accent intensity and saturation for lower glare while retaining meaningful status colors." shortcut="⌘⇧C" onChange={(comfortMode) => update({ comfortMode })} />
              <Toggle checked={preferences.adaptiveCalm} label="Intelligent Calm" description="Quiet nonessential visual noise during modeling, valuation, reading, research and spreadsheets; keep alerts visible." onChange={(adaptiveCalm) => update({ adaptiveCalm })} />
              <Toggle checked={preferences.ambientContext} label="Ambient context" description="Subtle background depth behind analysis, subordinate to charts, models and reading." onChange={(ambientContext) => update({ ambientContext })} />
              <Toggle checked={preferences.visualEnvironmentsEnabled} label="Contextual visual environments" description="Show optional Project environments on launch, Project Home and conversation edges. Analysis stays in Focus mode." onChange={(visualEnvironmentsEnabled) => update({ visualEnvironmentsEnabled })} />
              <Toggle checked={preferences.visualEnvironmentMotion} label="Subtle environment motion" description="Allow slow visual movement. Reduced Motion and Low-resource modes always take precedence." onChange={(visualEnvironmentMotion) => update({ visualEnvironmentMotion })} />
              <Toggle checked={preferences.lowResourceMode} label="Low-resource visual mode" description="Disable environmental motion layers and prefer lightweight assets to save GPU, memory and battery." onChange={(lowResourceMode) => update({ lowResourceMode })} />
              <Toggle checked={preferences.showImmersiveDock} label="Immersive context dock" description="Keep Pin, Research, Evidence, Focus and analysis tools near the active pane, without a permanent sidebar." onChange={(showImmersiveDock) => update({ showImmersiveDock })} />
            </div>
          </section>

          <section aria-label="Layout density">
            <SectionTitle>Density</SectionTitle>
            <div role="group" aria-label="Layout density" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["terminal", "compact", "standard", "comfortable"] as const).map((density) => (
                <button key={density} type="button" aria-pressed={preferences.density === density}
                  onClick={() => update({ density })} className={optionClass(preferences.density === density)}>
                  <span className="capitalize">{density}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 font-ui text-xs leading-5 text-muted-foreground">
              Terminal maximizes density; Compact shows more data; Standard balances scanning and detail; Comfortable increases spacing without changing data.
            </p>
          </section>

          <section aria-label="Canvas modes">
            <SectionTitle>Canvas modes</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle checked={preferences.focusMode} label="Focus mode" description="Quiet the surrounding controls and emphasize the active analytical pane." shortcut="⌘⇧F" onChange={(focusMode) => update({ focusMode, presentationMode: focusMode ? false : preferences.presentationMode })} />
              <Toggle checked={preferences.presentationMode} label="Meeting / Presentation mode" description="Show a clean briefing view without changing the underlying workspace." shortcut="⌘⇧P" onChange={(presentationMode) => update({ presentationMode, focusMode: presentationMode ? false : preferences.focusMode })} />
            </div>
          </section>

          <section aria-label="Chrome and accessibility">
            <SectionTitle>Chrome &amp; accessibility</SectionTitle>
            <div className="mb-3 rounded-xl border border-border/70 bg-white/[0.012] p-3">
              <h4 className="mb-3 font-ui text-sm font-semibold text-foreground">Visual accessibility</h4>
              <ThemeSwitcher />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle checked={preferences.showTickerTape} label="Market ticker tape" description="Show the market ticker outside Focus or Meeting mode." onChange={(showTickerTape) => update({ showTickerTape })} />
              <Toggle checked={preferences.showMacroTickerTape} label="Macro ticker tape" description="Show macroeconomic context near the lower shell." onChange={(showMacroTickerTape) => update({ showMacroTickerTape })} />
              <Toggle checked={preferences.showJourneyPrompts} label="Journey prompts" description="Show relevant next actions and analysis guidance." onChange={(showJourneyPrompts) => update({ showJourneyPrompts })} />
              <Toggle checked={preferences.reducedMotion} label="Reduced motion" description="Disable nonessential movement and transitions while keeping status understandable." onChange={(reducedMotion) => update({ reducedMotion })} />
            </div>
          </section>

          <section aria-label="Text scale">
            <SectionTitle>Text scale</SectionTitle>
            <div role="group" aria-label="Text scale" className="grid grid-cols-3 gap-2">
              {(["small", "normal", "large"] as const).map((textScale) => (
                <button key={textScale} type="button" aria-pressed={preferences.textScale === textScale}
                  onClick={() => update({ textScale })} className={optionClass(preferences.textScale === textScale)}>
                  <span className="capitalize">{textScale}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-white/[0.012] p-4 font-ui text-xs leading-5 text-muted-foreground">
            <MoonStar className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <p><strong className="text-foreground">Designed for deep work.</strong> LiOS limits unnecessary motion and visual noise to prioritize the task.</p>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-white/[0.012] p-4 font-ui text-xs leading-5 text-muted-foreground">
            <MonitorPlay className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <p><strong className="text-foreground">Presentation-only preferences.</strong> Display settings never expand permissions or change model calculations.</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/70 bg-[#090909] px-4 py-3 sm:px-5">
          <p className="font-ui text-xs text-muted-foreground">Changes are saved automatically.</p>
          <button type="button" onClick={onClose}
            className="min-h-11 rounded-md bg-primary px-5 py-2 font-ui text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
