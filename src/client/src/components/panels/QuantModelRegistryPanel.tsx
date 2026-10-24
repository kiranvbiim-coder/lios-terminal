import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpenCheck, CheckCircle2, ChevronDown, ChevronRight, Database, FlaskConical, Search } from "lucide-react";
import type { QuantModelRegistryEntry, QuantModelStatus } from "@shared/quantModelRegistry";

type RegistryResponse = {
  models: QuantModelRegistryEntry[];
  summary: {
    total: number;
    byStatus: Record<string, number>;
    byValidation: Record<string, number>;
    byCategory: Record<string, number>;
    byProgram: Record<string, number>;
    limitationsOpen: number;
  };
  registryVersion: string;
};

const STATUS_FILTERS: Array<"all" | QuantModelStatus> = ["all", "validated", "implemented", "experimental", "synthetic", "planned"];

function statusTone(status: QuantModelStatus) {
  if (status === "validated") return "border-emerald-400/35 text-emerald-300";
  if (status === "implemented") return "border-sky-400/35 text-sky-300";
  if (status === "experimental") return "border-amber-400/35 text-amber-300";
  if (status === "synthetic") return "border-red-400/35 text-red-300";
  return "border-border text-muted-foreground";
}

function label(value: string) {
  return value.replaceAll("_", " ").toUpperCase();
}

export default function QuantModelRegistryPanel() {
  const [search, setSearch] = useTerminalArtifactState("QuantModelRegistryPanel.search", "");
  const [status, setStatus] = useTerminalArtifactState<"all" | QuantModelStatus>("QuantModelRegistryPanel.status", "all");
  const [program, setProgram] = useTerminalArtifactState("QuantModelRegistryPanel.program", "all");
  const [category, setCategory] = useTerminalArtifactState("QuantModelRegistryPanel.category", "all");
  const [expanded, setExpanded] = useTerminalArtifactState<string | null>("QuantModelRegistryPanel.expanded", null);
  const { data, isLoading, error } = useQuery<RegistryResponse>({ queryKey: ["/api/quant/registry"] });

  const categories = useMemo(() => Object.keys(data?.summary.byCategory ?? {}).sort(), [data]);
  const models = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.models ?? []).filter((model) => (
      (status === "all" || model.status === status)
      && (program === "all" || model.program === program)
      && (category === "all" || model.category === category)
      && (!term || [model.label, model.category, model.engine, ...model.components].some((value) => value.toLowerCase().includes(term)))
    ));
  }, [category, data, program, search, status]);

  if (isLoading) return <div className="h-full grid place-items-center font-terminal text-[9px] text-muted-foreground">LOADING MODEL REGISTRY</div>;
  if (error || !data) return <div className="h-full grid place-items-center font-terminal text-[9px] text-red-300">MODEL REGISTRY UNAVAILABLE</div>;

  return (
    <div className="h-full min-h-0 flex flex-col bg-background text-foreground overflow-hidden">
      <header className="shrink-0 border-b border-border px-4 py-3 flex flex-wrap items-center gap-3">
        <BookOpenCheck className="w-4 h-4 text-amber-300" />
        <div>
          <div className="font-terminal text-[10px] tracking-wider">QUANT MODEL REGISTRY</div>
          <div className="font-mono text-[7px] text-muted-foreground">REGISTRY {data.registryVersion} / CAPABILITY, VALIDATION AND LIMITATIONS</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-4 font-mono text-[8px]">
          <span><b className="text-foreground">{data.summary.total}</b> MODELS</span>
          <span className="text-emerald-300"><b>{data.summary.byStatus.validated ?? 0}</b> VALIDATED</span>
          <span className="text-sky-300"><b>{data.summary.byStatus.implemented ?? 0}</b> IMPLEMENTED</span>
          <span className="text-amber-300"><b>{data.summary.byStatus.experimental ?? 0}</b> EXPERIMENTAL</span>
        </div>
      </header>

      <div className="shrink-0 border-b border-border px-4 py-2 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 max-w-md">
          <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="SEARCH MODEL OR COMPONENT" className="h-8 w-full border border-border bg-black pl-8 pr-2 font-terminal text-[8px] outline-none focus:border-amber-400/50" />
        </div>
        <select value={program} onChange={(event) => setProgram(event.target.value)} className="h-8 border border-border bg-black px-2 font-terminal text-[8px] outline-none">
          <option value="all">ALL PROGRAMS</option>
          <option value="quant_acceleration">QUANT ACCELERATION</option>
          <option value="financial_modelling">FINANCIAL MODELLING</option>
          <option value="shared_foundation">SHARED FOUNDATION</option>
        </select>
        <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-8 max-w-56 border border-border bg-black px-2 font-terminal text-[8px] outline-none">
          <option value="all">ALL CATEGORIES</option>
          {categories.map((item) => <option key={item} value={item}>{label(item)}</option>)}
        </select>
      </div>

      <div className="shrink-0 border-b border-border px-4 py-2 flex flex-wrap items-center gap-1">
        {STATUS_FILTERS.map((item) => (
          <button key={item} onClick={() => setStatus(item)} className={`h-7 px-2 border font-terminal text-[7px] ${status === item ? "border-amber-400/50 text-amber-300 bg-amber-400/5" : "border-border text-muted-foreground"}`}>
            {item === "all" ? `ALL ${data.summary.total}` : `${label(item)} ${data.summary.byStatus[item] ?? 0}`}
          </button>
        ))}
        <span className="ml-auto font-mono text-[7px] text-muted-foreground">SHOWING {models.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 grid grid-cols-[24px_minmax(190px,1.3fr)_minmax(120px,.8fr)_110px_120px_100px] gap-2 border-b border-border bg-black px-3 py-2 font-terminal text-[7px] text-muted-foreground">
          <span /> <span>MODEL</span><span>CATEGORY</span><span>STATUS</span><span>VALIDATION</span><span>ENGINE</span>
        </div>
        {models.map((model) => {
          const open = expanded === model.id;
          return (
            <div key={model.id} className="border-b border-border/70">
              <button onClick={() => setExpanded(open ? null : model.id)} className="w-full grid grid-cols-[24px_minmax(190px,1.3fr)_minmax(120px,.8fr)_110px_120px_100px] gap-2 items-center px-3 py-2 text-left hover:bg-white/[0.025]">
                {open ? <ChevronDown className="w-3.5 h-3.5 text-amber-300" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                <span className="min-w-0"><span className="block truncate font-terminal text-[8px]">{model.label}</span><span className="block truncate font-mono text-[7px] text-muted-foreground">{model.id} / v{model.version}</span></span>
                <span className="truncate font-mono text-[7px] text-muted-foreground">{label(model.category)}</span>
                <span className={`w-fit border px-1.5 py-0.5 font-terminal text-[7px] ${statusTone(model.status)}`}>{label(model.status)}</span>
                <span className="truncate font-mono text-[7px] text-muted-foreground">{label(model.validationLevel)}</span>
                <span className="truncate font-mono text-[7px] text-muted-foreground">{label(model.engine)}</span>
              </button>
              {open && (
                <div className="grid md:grid-cols-3 gap-0 border-t border-border/50 bg-black/40">
                  <section className="px-4 py-3 md:border-r border-border/50">
                    <div className="mb-2 flex items-center gap-2 font-terminal text-[7px] text-amber-300"><FlaskConical className="w-3.5 h-3.5" /> COMPONENTS</div>
                    <div className="flex flex-wrap gap-1">{model.components.map((item) => <span key={item} className="border border-border px-1.5 py-1 font-mono text-[7px] text-muted-foreground">{item}</span>)}</div>
                  </section>
                  <section className="px-4 py-3 md:border-r border-border/50">
                    <div className="mb-2 flex items-center gap-2 font-terminal text-[7px] text-amber-300"><AlertTriangle className="w-3.5 h-3.5" /> LIMITATIONS</div>
                    {model.limitations.map((item) => <p key={item} className="font-mono text-[8px] leading-relaxed text-muted-foreground">{item}</p>)}
                    <p className="mt-2 font-mono text-[8px] leading-relaxed text-sky-300">NEXT: {model.nextValidation}</p>
                  </section>
                  <section className="px-4 py-3">
                    <div className="mb-2 flex items-center gap-2 font-terminal text-[7px] text-amber-300"><Database className="w-3.5 h-3.5" /> LINEAGE</div>
                    <p className="font-mono text-[7px] text-muted-foreground">{label(model.dataMode)} / {label(model.determinism)}</p>
                    {model.apiEndpoint && <p className="mt-1 font-mono text-[7px] text-sky-300">{model.apiEndpoint}</p>}
                    {model.sourceFiles.map((item) => <p key={item} className="mt-1 truncate font-mono text-[7px] text-muted-foreground">{item}</p>)}
                    {model.references.map((item) => <a key={item.url} href={item.url} target="_blank" rel="noreferrer" className="mt-2 mr-2 inline-flex items-center gap-1 font-mono text-[7px] text-amber-300 hover:underline"><CheckCircle2 className="w-3 h-3" />{item.label}</a>)}
                  </section>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
