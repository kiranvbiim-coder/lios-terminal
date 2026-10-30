import { useMemo, useState } from "react";
import { Eye, Focus, MoonStar, MonitorPlay, Settings2, Wrench } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import ThemeSwitcher from "./ThemeSwitcher";
import {
  patchTerminalUxPreferences, saveTerminalUxPreferences,
  type TerminalUxPreferences,
} from "@/lib/terminalUxPreferences";
import { getSettingsAdvancedCapabilities } from "@/lib/terminalCatalog";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props {
  preferences: TerminalUxPreferences;
  onChange: (preferences: TerminalUxPreferences) => void;
  onClose: () => void;
  isInternal: boolean;
  /** Opens a Settings › Advanced tool through the normal audience-checked view routing. */
  onOpenView: (view: ViewMode) => void;
}

function Toggle({ checked, label, description, onChange, shortcut }: { checked: boolean; label: string; description: string; onChange: (value: boolean) => void; shortcut?: string }) {
  return (
    <label className="font-ui group flex cursor-pointer items-start gap-3 rounded-xl border border-border/55 bg-white/[0.012] p-3 transition-colors hover:border-border hover:bg-white/[0.025]">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-foreground">{label}</span><span className="mt-1 block text-sm leading-6 text-muted-foreground">{description}</span></span>
      {shortcut && <kbd className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted-foreground">{shortcut}</kbd>}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 font-ui text-sm font-semibold text-muted-foreground">{children}</h2>;
}

export default function TerminalUxSettings({ preferences, onChange, onClose, isInternal, onOpenView }: Props) {
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const advancedTools = useMemo(() => getSettingsAdvancedCapabilities(isInternal), [isInternal]);
  const motionStyle = preferences.reducedMotion ? { animation: "none", transition: "none" } : undefined;
  const update = (patch: Partial<TerminalUxPreferences>) => {
    const next = patchTerminalUxPreferences(preferences, patch);
    saveTerminalUxPreferences(next);
    onChange(next);
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className={`flex max-h-[90dvh] w-[calc(100vw-24px)] max-w-3xl flex-col gap-0 overflow-hidden bg-background p-0 ${preferences.reducedMotion ? "[&_*]:!transition-none [&_*]:!animate-none" : ""}`}
        style={{ ...motionStyle, animation: "none", transform: "translate(-50%, -50%)" }} overlayProps={{ style: motionStyle }}
        onCloseAutoFocus={event => { event.preventDefault(); if (opener?.isConnected) opener.focus(); }}>
        <header className="shrink-0 border-b border-border p-4 pr-12">
          <Settings2 className="mb-2 h-5 w-5 text-primary"/>
          <DialogTitle>Experience &amp; Comfort</DialogTitle>
          <DialogDescription>Presentation preferences never expand analytical permissions. Changes apply immediately; persistence depends on device storage.</DialogDescription>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 scrollbar-thin sm:p-5">
          <section>
            <SectionTitle>Experience mode</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              <button aria-pressed={preferences.experienceMode === "guided"} onClick={() => update({ experienceMode: "guided", density: preferences.density === "terminal" || preferences.density === "compact" ? "standard" : preferences.density })} className="min-h-11 rounded-xl border border-border p-4 text-left font-ui focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><Eye className="h-4 w-4 text-primary"/><span className="mt-2 block text-base font-semibold">Guided</span><span className="mt-1 block text-sm leading-6 text-muted-foreground">More explanation and larger targets. All existing capabilities remain available.</span></button>
              <button aria-pressed={preferences.experienceMode === "professional"} onClick={() => update({ experienceMode: "professional" })} className="min-h-11 rounded-xl border border-border p-4 text-left font-ui focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><Focus className="h-4 w-4 text-primary"/><span className="mt-2 block text-base font-semibold">Professional</span><span className="mt-1 block text-sm leading-6 text-muted-foreground">Dense analytical context with keyboard-first professional controls.</span></button>
            </div>
          </section>

          <section>
            <SectionTitle>Long-session visual comfort</SectionTitle>
            <div className="grid gap-2">
              <Toggle checked={preferences.comfortMode} label="Comfort mode" description="Reduces accent intensity and saturation for lower-glare extended sessions while preserving semantic status colors." shortcut="⌘⇧C" onChange={(comfortMode) => update({ comfortMode })} />
              <Toggle checked={preferences.adaptiveCalm} label="Intelligent Calm" description="When modeling, valuing, reading statements, researching or using a spreadsheet, LiOS automatically quiets nonessential visual noise while keeping alerts and truth-state signals visible." onChange={(adaptiveCalm) => update({ adaptiveCalm })} />
              <Toggle checked={preferences.ambientContext} label="Ambient context" description="Keep subtle graphite/amber/cyan atmospheric depth behind analytical work. This remains subordinate to charts, models and reading." onChange={(ambientContext) => update({ ambientContext })} />
              <Toggle checked={preferences.visualEnvironmentsEnabled} label="Contextual visual environments" description="Use LiOS-owned Project environments on launch, Project Home and conversation edges. Dense analytical surfaces automatically recede into Focus mode." onChange={(visualEnvironmentsEnabled) => update({ visualEnvironmentsEnabled })} />
              <div className="rounded-xl border border-border/55 bg-white/[0.012] p-3">
                <h3 className="font-ui text-sm font-semibold text-foreground">Visual atmosphere intensity</h3>
                <p className="my-2 font-ui text-sm leading-5 text-muted-foreground">Optional. Focus remains matte, and Immersive never overrides a reading or Workbench surface.</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Visual atmosphere intensity">
                  {(["auto", "immersive", "contextual", "focus"] as const).map(visualIntensity => (
                    <button key={visualIntensity} type="button" aria-pressed={preferences.visualIntensity === visualIntensity}
                      onClick={() => update({ visualIntensity })}
                      className="min-h-11 rounded-lg border border-border px-3 py-2 font-ui text-sm capitalize aria-pressed:border-primary aria-pressed:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                      {visualIntensity === "auto" ? "Adaptive" : visualIntensity}
                    </button>
                  ))}
                </div>
              </div>
              <Toggle checked={preferences.visualEnvironmentMotion} label="Subtle environment motion" description="Allow very slow light/parallax drift in Immersive and Contextual states. Reduced Motion and Low-resource mode always override this." onChange={(visualEnvironmentMotion) => update({ visualEnvironmentMotion })} />
              <Toggle checked={preferences.lowResourceMode} label="Low-resource visual mode" description="Disable environmental light/grain motion layers and prefer lightweight assets for lower GPU, memory and battery use." onChange={(lowResourceMode) => update({ lowResourceMode })} />
              <Toggle checked={preferences.showImmersiveDock} label="Immersive context dock" description="Keep Pin, Research, Evidence, Focus and advanced analysis tools close to the active pane without another permanent sidebar." onChange={(showImmersiveDock) => update({ showImmersiveDock })} />
            </div>
          </section>

          <section>
            <SectionTitle>Density</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{(["terminal", "compact", "standard", "comfortable"] as const).map(density => <button key={density} aria-pressed={preferences.density === density} onClick={() => update({ density })} className="min-h-11 rounded border border-border px-3 py-2 font-ui text-sm capitalize aria-pressed:border-primary aria-pressed:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{density}</button>)}</div>
            <p className="mt-2 font-ui text-sm leading-6 text-muted-foreground">Density changes spacing and controls, never the underlying data.</p>
          </section>

          <section>
            <SectionTitle>Canvas modes</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2"><Toggle checked={preferences.focusMode} label="Focus mode" description="Quiet nonessential chrome and push the active analytical pane forward." shortcut="⌘⇧F" onChange={(focusMode) => update({ focusMode, presentationMode: focusMode ? false : preferences.presentationMode })} /><Toggle checked={preferences.presentationMode} label="Meeting / Presentation mode" description="Create a clean briefing/client surface with navigation-heavy terminal chrome removed while keeping the underlying workspace intact." shortcut="⌘⇧P" onChange={(presentationMode) => update({ presentationMode, focusMode: presentationMode ? false : preferences.focusMode })} /></div>
          </section>

          <section>
            <SectionTitle>Chrome & accessibility</SectionTitle>
            <div className="mb-2 rounded-xl border border-border/55 bg-white/[0.012] p-3">
              <h3 className="mb-2 font-ui text-sm font-semibold text-foreground">Visual accessibility</h3>
              <ThemeSwitcher />
            </div>
            <div className="grid gap-2 sm:grid-cols-2"><Toggle checked={preferences.showTickerTape} label="Market ticker tape" description="Show the fast market ticker outside Focus/Meeting mode." onChange={(showTickerTape) => update({ showTickerTape })} /><Toggle checked={preferences.showMacroTickerTape} label="Macro ticker tape" description="Show macro context near the lower shell." onChange={(showMacroTickerTape) => update({ showMacroTickerTape })} /><Toggle checked={preferences.showJourneyPrompts} label="Journey prompts" description="Surface connected next actions and analysis-journey guidance." onChange={(showJourneyPrompts) => update({ showJourneyPrompts })} /><Toggle checked={preferences.reducedMotion} label="Reduced motion" description="Disable nonessential movement and transitions while keeping state readable." onChange={(reducedMotion) => update({ reducedMotion })} /></div>
          </section>

          <section>
            <SectionTitle>Text scale</SectionTitle>
            <div className="grid grid-cols-3 gap-2">{(["small", "normal", "large"] as const).map(textScale => <button key={textScale} aria-pressed={preferences.textScale === textScale} onClick={() => update({ textScale })} className="min-h-11 rounded border border-border px-3 py-2 font-ui text-sm capitalize aria-pressed:border-primary aria-pressed:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{textScale}</button>)}</div>
          </section>

          {advancedTools.length > 0 && (
            <section aria-labelledby="settings-advanced-title" data-testid="settings-advanced">
              <h2 id="settings-advanced-title" className="mb-2 font-ui text-sm font-semibold text-muted-foreground">Advanced</h2>
              <p className="mb-2 font-ui text-sm leading-6 text-muted-foreground">Administration, data sources and diagnostics. These open in the Workbench; your access rules still apply.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {advancedTools.map((tool) => (
                  <button key={tool.view} type="button" data-testid={`settings-advanced-${tool.view}`}
                    onClick={() => { onOpenView(tool.view); onClose(); }}
                    className="min-h-11 rounded-xl border border-border/55 bg-white/[0.012] p-3 text-left font-ui hover:border-border hover:bg-white/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><Wrench className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />{tool.label}</span>
                    <span className="mt-1 block text-sm leading-5 text-muted-foreground">{tool.description}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <p className="font-ui text-sm leading-6 text-muted-foreground"><MoonStar className="mr-2 inline h-4 w-4"/>Comfort and motion preferences support extended analytical work.</p>
          <p className="font-ui text-sm leading-6 text-muted-foreground"><MonitorPlay className="mr-2 inline h-4 w-4"/>Local presentation settings do not change model calculations, source rights or execution permissions.</p>
        </div>
        <footer className="shrink-0 border-t border-border p-3 text-right"><button type="button" onClick={onClose} className="min-h-11 rounded border border-border px-4 py-2 font-ui text-sm">Done</button></footer>
      </DialogContent>
    </Dialog>
  );
}
