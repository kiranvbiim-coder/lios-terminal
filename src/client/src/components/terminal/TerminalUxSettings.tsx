import { Eye, Focus, MoonStar, MonitorPlay, Settings2, X } from "lucide-react";
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

function Toggle({ checked, label, description, onChange, shortcut }: { checked: boolean; label: string; description: string; onChange: (value: boolean) => void; shortcut?: string }) {
  return (
    <label className="font-ui group flex cursor-pointer items-start gap-3 rounded-xl border border-border/55 bg-white/[0.012] p-3 transition-colors hover:border-border hover:bg-white/[0.025]">
      <span className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full border p-0.5 transition-colors ${checked ? "border-amber-400/35 bg-amber-400/[0.12]" : "border-border/80 bg-black/20"}`}>
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
        <span className={`h-2.5 w-2.5 rounded-full transition-transform ${checked ? "translate-x-3 bg-amber-300" : "translate-x-0 bg-muted-foreground/55"}`} />
      </span>
      <span className="min-w-0 flex-1"><span className="block text-[9px] font-semibold text-foreground">{label}</span><span className="mt-1 block text-[8px] leading-relaxed text-muted-foreground">{description}</span></span>
      {shortcut && <kbd className="lios-pane-code shrink-0 rounded-md border border-border/60 px-1.5 py-1 text-[6px] text-muted-foreground">{shortcut}</kbd>}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="font-ui mb-2 text-[8px] font-semibold uppercase tracking-[0.13em] text-muted-foreground/80">{children}</div>;
}

export default function TerminalUxSettings({ preferences, onChange, onClose }: Props) {
  const update = (patch: Partial<TerminalUxPreferences>) => {
    const next = patchTerminalUxPreferences(preferences, patch);
    saveTerminalUxPreferences(next);
    onChange(next);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3 backdrop-blur-[3px]" onMouseDown={onClose}>
      <section className="lios-v4-overlay w-full max-w-3xl overflow-hidden rounded-2xl" onMouseDown={(event) => event.stopPropagation()} aria-label="Terminal experience settings">
        <header className="flex items-start gap-3 border-b border-border/55 p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/[0.045] text-cyan-300"><Settings2 className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1"><div className="font-ui text-[12px] font-semibold tracking-tight text-foreground">Experience & Comfort</div><div className="font-ui mt-1 text-[8px] leading-relaxed text-muted-foreground">Tune LiOS for deep work, quick analysis, meetings, and long sessions without changing analytical permissions.</div></div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
        </header>

        <div className="max-h-[78vh] space-y-6 overflow-y-auto p-4 scrollbar-thin sm:p-5">
          <section>
            <SectionTitle>Experience mode</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              <button onClick={() => update({ experienceMode: "guided", density: preferences.density === "terminal" || preferences.density === "compact" ? "standard" : preferences.density })} className={`rounded-2xl border p-4 text-left transition-all ${preferences.experienceMode === "guided" ? "border-amber-400/30 bg-amber-400/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,.025)]" : "border-border/55 bg-white/[0.01] hover:border-border hover:bg-white/[0.025]"}`}><Eye className="h-4 w-4 text-amber-300/85" /><div className="font-ui mt-3 text-[10px] font-semibold text-foreground">Guided</div><p className="font-ui mt-1 text-[8px] leading-relaxed text-muted-foreground">More explanation, larger targets, workflow prompts, and hero actions first. All capabilities remain available.</p></button>
              <button onClick={() => update({ experienceMode: "professional" })} className={`rounded-2xl border p-4 text-left transition-all ${preferences.experienceMode === "professional" ? "border-cyan-400/30 bg-cyan-400/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,.025)]" : "border-border/55 bg-white/[0.01] hover:border-border hover:bg-white/[0.025]"}`}><Focus className="h-4 w-4 text-cyan-300/85" /><div className="font-ui mt-3 text-[10px] font-semibold text-foreground">Professional</div><p className="font-ui mt-1 text-[8px] leading-relaxed text-muted-foreground">Dense analytical context, terminal commands, keyboard-first interaction, and maximum workspace flexibility.</p></button>
            </div>
          </section>

          <section>
            <SectionTitle>Long-session visual comfort</SectionTitle>
            <div className="grid gap-2">
              <Toggle checked={preferences.comfortMode} label="Comfort mode" description="Reduces accent intensity and saturation for lower-glare extended sessions while preserving semantic status colors." shortcut="⌘⇧C" onChange={(comfortMode) => update({ comfortMode })} />
              <Toggle checked={preferences.adaptiveCalm} label="Intelligent Calm" description="When modeling, valuing, reading statements, researching or using a spreadsheet, LiOS automatically quiets nonessential visual noise while keeping alerts and truth-state signals visible." onChange={(adaptiveCalm) => update({ adaptiveCalm })} />
              <Toggle checked={preferences.ambientContext} label="Ambient context" description="Keep subtle graphite/amber/cyan atmospheric depth behind analytical work. This remains subordinate to charts, models and reading." onChange={(ambientContext) => update({ ambientContext })} />
              <Toggle checked={preferences.visualEnvironmentsEnabled} label="Contextual visual environments" description="Use LiOS-owned Project environments on launch, Project Home and conversation edges. Dense analytical surfaces automatically recede into Focus mode." onChange={(visualEnvironmentsEnabled) => update({ visualEnvironmentsEnabled })} />
              <Toggle checked={preferences.visualEnvironmentMotion} label="Subtle environment motion" description="Allow very slow light/parallax drift in Immersive and Contextual states. Reduced Motion and Low-resource mode always override this." onChange={(visualEnvironmentMotion) => update({ visualEnvironmentMotion })} />
              <Toggle checked={preferences.lowResourceMode} label="Low-resource visual mode" description="Disable environmental light/grain motion layers and prefer lightweight assets for lower GPU, memory and battery use." onChange={(lowResourceMode) => update({ lowResourceMode })} />
              <Toggle checked={preferences.showImmersiveDock} label="Immersive context dock" description="Keep Pin, Research, Evidence, Focus and advanced analysis tools close to the active pane without another permanent sidebar." onChange={(showImmersiveDock) => update({ showImmersiveDock })} />
            </div>
          </section>

          <section>
            <SectionTitle>Density</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{(["terminal", "compact", "standard", "comfortable"] as const).map((density) => <button key={density} onClick={() => update({ density })} className={`font-ui rounded-xl border px-3 py-2.5 text-[8px] font-semibold capitalize transition-colors ${preferences.density === density ? "border-amber-400/30 bg-amber-400/[0.045] text-amber-200" : "border-border/55 bg-white/[0.01] text-muted-foreground hover:bg-white/[0.025] hover:text-foreground"}`}>{density}</button>)}</div>
            <p className="font-ui mt-2 text-[7.5px] leading-relaxed text-muted-foreground">Terminal is the maximum-density professional workstation preset, Compact keeps more data visible with slightly larger controls, Standard balances scan speed and detail, and Comfortable increases row/control breathing room without changing the underlying data.</p>
          </section>

          <section>
            <SectionTitle>Canvas modes</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2"><Toggle checked={preferences.focusMode} label="Focus mode" description="Quiet nonessential chrome and push the active analytical pane forward." shortcut="⌘⇧F" onChange={(focusMode) => update({ focusMode, presentationMode: focusMode ? false : preferences.presentationMode })} /><Toggle checked={preferences.presentationMode} label="Meeting / Presentation mode" description="Create a clean briefing/client surface with navigation-heavy terminal chrome removed while keeping the underlying workspace intact." shortcut="⌘⇧P" onChange={(presentationMode) => update({ presentationMode, focusMode: presentationMode ? false : preferences.focusMode })} /></div>
          </section>

          <section>
            <SectionTitle>Chrome & accessibility</SectionTitle>
            <div className="mb-2 rounded-xl border border-border/55 bg-white/[0.012] p-3">
              <div className="font-ui mb-2 text-[8px] font-semibold text-foreground">Visual accessibility</div>
              <ThemeSwitcher />
            </div>
            <div className="grid gap-2 sm:grid-cols-2"><Toggle checked={preferences.showTickerTape} label="Market ticker tape" description="Show the fast market ticker outside Focus/Meeting mode." onChange={(showTickerTape) => update({ showTickerTape })} /><Toggle checked={preferences.showMacroTickerTape} label="Macro ticker tape" description="Show macro context near the lower shell." onChange={(showMacroTickerTape) => update({ showMacroTickerTape })} /><Toggle checked={preferences.showJourneyPrompts} label="Journey prompts" description="Surface connected next actions and analysis-journey guidance." onChange={(showJourneyPrompts) => update({ showJourneyPrompts })} /><Toggle checked={preferences.reducedMotion} label="Reduced motion" description="Disable nonessential movement and transitions while keeping state readable." onChange={(reducedMotion) => update({ reducedMotion })} /></div>
          </section>

          <section>
            <SectionTitle>Text scale</SectionTitle>
            <div className="grid grid-cols-3 gap-2">{(["small", "normal", "large"] as const).map((textScale) => <button key={textScale} onClick={() => update({ textScale })} className={`font-ui rounded-xl border px-3 py-2.5 text-[8px] font-semibold capitalize transition-colors ${preferences.textScale === textScale ? "border-cyan-400/30 bg-cyan-400/[0.045] text-cyan-200" : "border-border/55 bg-white/[0.01] text-muted-foreground hover:bg-white/[0.025] hover:text-foreground"}`}>{textScale}</button>)}</div>
          </section>

          <div className="font-ui flex items-start gap-3 rounded-2xl border border-border/55 bg-white/[0.012] p-3 text-[8px] leading-relaxed text-muted-foreground"><MoonStar className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/75" /><div><span className="font-semibold text-foreground">Designed for deep work.</span> LiOS deliberately avoids engagement tricks and decorative animation. These controls optimize visual comfort and continuity, not time-on-screen for its own sake.</div></div>
          <div className="font-ui flex items-start gap-3 rounded-2xl border border-border/55 bg-white/[0.012] p-3 text-[8px] leading-relaxed text-muted-foreground"><MonitorPlay className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300/75" /><div><span className="font-semibold text-foreground">Local preference state.</span> Guided/Professional, Comfort, Focus and visual settings are presentation preferences only; they never expand permissions or change underlying model calculations.</div></div>
        </div>
      </section>
    </div>
  );
}
