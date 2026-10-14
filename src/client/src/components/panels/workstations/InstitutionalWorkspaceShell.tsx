import type { ReactNode } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import type { WorkstationDefinition } from "./workstationDefinitions";

interface InstitutionalWorkspaceShellProps {
  definition: WorkstationDefinition;
  activeSection: string;
  onSection: (sectionId: string) => void;
  symbol?: string;
  status?: { label: string; tone: "ok" | "watch" | "blocked" };
  children: ReactNode;
}

function statusClass(tone: "ok" | "watch" | "blocked") {
  if (tone === "blocked") return "text-red-300 border-red-500/35 bg-red-500/5";
  if (tone === "watch") return "text-amber-300 border-amber-500/35 bg-amber-500/5";
  return "text-emerald-300 border-emerald-500/30 bg-emerald-500/5";
}

export function InstitutionalWorkspaceShell({ definition, activeSection, onSection, symbol, status, children }: InstitutionalWorkspaceShellProps) {
  const active = definition.sections.find((section) => section.id === activeSection) ?? definition.sections[0];
  return (
    <div className="h-full min-h-0 flex flex-col bg-[#050505] text-foreground overflow-hidden" data-institutional-shell>
      <div className="shrink-0 border-b border-border/70 bg-[#070707] px-2.5 py-1.5" data-institutional-header>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-terminal text-[9px] font-bold tracking-[0.12em] text-foreground">{definition.title}</span>
          {symbol ? <span className="shrink-0 border-l border-border/70 pl-2 font-terminal text-[8px] font-bold tracking-wider text-amber-300">{symbol}</span> : null}
          {status ? <span className={`ml-auto shrink-0 border px-1.5 py-0.5 font-terminal text-[7px] tracking-wider ${statusClass(status.tone)}`}>{status.label}</span> : null}
        </div>
      </div>

      <nav className="shrink-0 border-b border-border/60 bg-[#090909]" data-institutional-nav aria-label={`${definition.title} analytical capabilities`}>
        <div className="flex items-stretch overflow-x-auto scrollbar-none">
          {definition.sections.map((section) => {
            const selected = section.id === active.id;
            return (
              <button
                type="button"
                key={section.id}
                onClick={() => onSection(section.id)}
                title={section.description}
                aria-current={selected ? "page" : undefined}
                className={`group min-w-fit border-r border-border/50 px-3 py-2 text-left transition-colors ${selected ? "bg-amber-500/[0.08] text-amber-300" : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"}`}
                data-institutional-nav-item
              >
                <div className="flex items-center gap-1.5">
                  <span className={`font-mono text-[7px] ${selected ? "text-amber-300" : "text-muted-foreground/55"}`}>[{section.code}]</span>
                  <span className="font-terminal text-[8px] font-bold tracking-wider">{section.label}</span>
                </div>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="flex-1 min-h-0 overflow-hidden" data-institutional-body>{children}</div>
    </div>
  );
}

interface WorkstationOverviewProps {
  definition: WorkstationDefinition;
  onSection: (sectionId: string) => void;
  eyebrow?: string;
  headline: string;
  description: string;
  trustItems?: readonly string[];
  skipSectionIds?: readonly string[];
}

export function WorkstationOverview({ definition, onSection, headline, trustItems = [], skipSectionIds = ["overview"] }: WorkstationOverviewProps) {
  const visible = definition.sections.filter((section) => !skipSectionIds.includes(section.id));
  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-3 md:p-4" data-workstation-overview>
      <div className="mx-auto max-w-[1600px] space-y-3">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-2" data-workstation-overview-hero>
          <div className="font-terminal text-[10px] font-bold tracking-[0.12em] text-foreground">{headline}</div>
          <div className="shrink-0 font-terminal text-[7px] tracking-widest text-muted-foreground">{visible.length} MODELS</div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5" data-workstation-overview-grid>
          {visible.map((section, index) => (
            <button
              type="button"
              key={section.id}
              onClick={() => onSection(section.id)}
              title={section.description}
              className="group min-h-16 border border-border bg-[#080808] p-3 text-left transition-colors hover:border-amber-500/45 hover:bg-amber-500/[0.035]"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[7px] text-muted-foreground/60">{String(index + 1).padStart(2, "0")}</span>
                <span className="font-mono text-[7px] text-amber-300/75">[{section.code}]</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="font-terminal text-[9px] font-bold tracking-wider text-foreground">{section.label}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-amber-300/50 transition-transform group-hover:translate-x-0.5 group-hover:text-amber-300" />
              </div>
            </button>
          ))}
        </div>

        {trustItems.length ? (
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto border-t border-cyan-500/15 pt-2 scrollbar-none" data-workstation-trust>
            <div className="flex shrink-0 items-center gap-1.5 font-terminal text-[7px] font-bold tracking-widest text-cyan-300"><ShieldCheck className="h-3 w-3" /> TRUST</div>
            {trustItems.map((item) => <span key={item} title={item} className="max-w-72 shrink-0 truncate border border-cyan-500/15 bg-cyan-500/[0.02] px-2 py-1 font-terminal text-[7px] text-muted-foreground">{item}</span>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MethodologyCard({ title, formula, detail, note }: { title: string; formula?: string; detail: string; note?: string }) {
  return (
    <div className="border border-border bg-[#080808] p-3">
      <div className="font-terminal text-[8px] font-bold tracking-widest text-foreground">{title}</div>
      {formula ? <div className="mt-2 overflow-x-auto border border-border/60 bg-black/30 px-2 py-1.5 font-mono text-[9px] text-amber-200">{formula}</div> : null}
      <div className="mt-2 font-terminal text-[8px] leading-4 text-muted-foreground">{detail}</div>
      {note ? <div className="mt-2 border-t border-border/60 pt-2 font-terminal text-[7px] leading-4 text-cyan-300/85">{note}</div> : null}
    </div>
  );
}
