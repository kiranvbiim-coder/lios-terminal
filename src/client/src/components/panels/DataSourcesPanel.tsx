import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDashed,
  Database,
  FileSpreadsheet,
  KeyRound,
  MessageSquare,
  Plug,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import AddAnyDataProviderWizard from "@/components/connections/AddAnyDataProviderWizard";
import DatabaseDiscoveryBrowser from "@/components/connections/DatabaseDiscoveryBrowser";
import {
  connectionCategoryCount,
  connectionCategoryItems,
} from "@/lib/connectionCenterV4";
import {
  CONNECTION_CENTER_CATEGORIES,
  type ConnectionCenterCategoryId,
} from "@shared/connectionCenter";
import type { SourceRegistry, SourceRegistryItem } from "@shared/sourceRegistry";

interface DataSourcesPanelProps {
  onConnectProvider: (connectorId?: string) => void;
  onImportFile: () => void;
  onAddDatabase: () => void;
  onAddApi: () => void;
  onAddStorage: () => void;
  onRefresh?: () => void;
  onTestConnection?: (connectionId: number) => void;
  onEditConnection?: (connectionId: number) => void;
  onDeleteConnection?: (connectionId: number) => void;
}

const STATE_CONFIG: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  catalog_only: { label: "Catalog only", className: "text-muted-foreground border-border", Icon: CircleDashed },
  adapter_available: { label: "Adapter ready", className: "text-muted-foreground border-border", Icon: KeyRound },
  credential_configured: { label: "Credential configured", className: "text-cyan-400 border-cyan-500/30", Icon: KeyRound },
  configured: { label: "Configured; untested", className: "text-cyan-400 border-cyan-500/30", Icon: KeyRound },
  live_verified: { label: "Live verified", className: "text-emerald-400 border-emerald-500/30", Icon: CheckCircle2 },
  healthy: { label: "Healthy", className: "text-emerald-400 border-emerald-500/30", Icon: CheckCircle2 },
  degraded: { label: "Degraded", className: "text-amber-400 border-amber-500/30", Icon: AlertTriangle },
  rate_limited: { label: "Rate limited", className: "text-orange-400 border-orange-500/30", Icon: AlertTriangle },
  unreachable: { label: "Unreachable", className: "text-amber-400 border-amber-500/30", Icon: AlertTriangle },
  invalid: { label: "Invalid", className: "text-red-400 border-red-500/30", Icon: AlertTriangle },
  disabled: { label: "Disabled", className: "text-muted-foreground border-border", Icon: CircleDashed },
};

const CATEGORY_ICONS = {
  data_providers: Plug,
  databases: Database,
  files: FileSpreadsheet,
  ai_providers: Bot,
  communications: MessageSquare,
} satisfies Record<ConnectionCenterCategoryId, typeof Plug>;

function formatCheckedAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `checked ${date.toLocaleString()}`;
}

function SourceCard({
  item,
  onConnectProvider,
  onTestConnection,
  onEditConnection,
  onDeleteConnection,
  onDiscoverDatabase,
}: {
  item: SourceRegistryItem;
  onConnectProvider: (connectorId?: string) => void;
  onTestConnection?: (connectionId: number) => void;
  onEditConnection?: (connectionId: number) => void;
  onDeleteConnection?: (connectionId: number) => void;
  onDiscoverDatabase?: (connectionId: number, name: string) => void;
}) {
  const config = STATE_CONFIG[item.state] ?? STATE_CONFIG.catalog_only;
  const Icon = config.Icon;
  const checkedAt = formatCheckedAt(item.lastCheckedAt);

  return (
    <article className="border border-border bg-[#070707] p-3" aria-label={`${item.name} source`}>
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${config.className.split(" ")[0]}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-ui text-sm font-semibold text-foreground">{item.name}</h3>
            <span className={`rounded border px-1.5 py-0.5 font-ui text-xs ${config.className}`}>{config.label}</span>
            <span className="rounded border border-border px-1.5 py-0.5 font-ui text-xs text-muted-foreground">{item.kind}</span>
          </div>
          <p className="mt-1 font-ui text-xs text-muted-foreground">{item.sourceType.replaceAll("_", " ")} · {item.category.replaceAll("_", " ")}</p>
        </div>
      </div>
      <p className="mt-2 font-ui text-sm leading-6 text-muted-foreground">{item.detail}</p>
      {checkedAt && <p className="mt-1 font-ui text-xs text-muted-foreground">{checkedAt}</p>}
      {item.licenseCaveat && <p className="mt-2 font-ui text-xs leading-5 text-amber-300">{item.licenseCaveat}</p>}
      <div className="mt-2 flex flex-wrap gap-1">
        {item.capabilities.map((capability) => (
          <span key={capability.contractFamily} className="rounded border border-border px-1.5 py-0.5 font-ui text-xs text-muted-foreground">{capability.contractFamily}</span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {item.kind === "catalog" && (
          <button type="button" className="min-h-10 rounded-md border border-primary/40 px-3 py-2 font-ui text-sm font-medium text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => onConnectProvider(item.connectorId)}>Configure</button>
        )}
        {item.kind === "connection" && item.connectionId !== null && (
          <>
            {item.sourceType === "database" && onDiscoverDatabase && <button type="button" className="inline-flex min-h-10 items-center gap-1 rounded-md border border-primary/40 px-3 py-2 font-ui text-sm text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => onDiscoverDatabase(item.connectionId!, item.name)}><Search className="h-3 w-3" /> Discover</button>}
            {onTestConnection && <button type="button" className="min-h-10 rounded-md border border-border px-3 py-2 font-ui text-sm text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => onTestConnection(item.connectionId!)}>Test</button>}
            {onEditConnection && <button type="button" className="min-h-10 rounded-md border border-border px-3 py-2 font-ui text-sm text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => onEditConnection(item.connectionId!)}>Edit</button>}
            {onDeleteConnection && <button type="button" aria-label={`Remove saved connection ${item.name}`} className="min-h-10 rounded-md border border-rose-500/30 px-3 py-2 font-ui text-sm text-rose-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => onDeleteConnection(item.connectionId!)}>Remove</button>}
          </>
        )}
      </div>
    </article>
  );
}

function EmptyCategory({ category }: { category: ConnectionCenterCategoryId }) {
  if (category === "communications") {
    return (
      <div className="border border-dashed border-border bg-[#070707] p-5">
        <p className="font-terminal text-[9px] font-bold uppercase tracking-wider text-foreground">Communication connections are intentionally not claimed yet</p>
        <p className="mt-2 max-w-2xl font-terminal text-[8px] leading-relaxed text-muted-foreground">Gmail, Microsoft 365, IMAP/SMTP, Slack, Teams and webhooks are not available as working connections in this build. They will appear here only after their permission, read or delivery, and failure paths are implemented and verified.</p>
      </div>
    );
  }
  if (category === "ai_providers") {
    return (
      <div className="border border-dashed border-border bg-[#070707] p-5">
        <p className="font-terminal text-[9px] font-bold uppercase tracking-wider text-foreground">AI remains optional</p>
        <p className="mt-2 max-w-2xl font-terminal text-[8px] leading-relaxed text-muted-foreground">Configure and verify an AI provider from this catalog, then select its provider and model under Runtime & AI Settings. A successful key check proves provider authentication, not that a conversation request has completed successfully.</p>
      </div>
    );
  }
  return <div className="border border-dashed border-border bg-[#070707] p-5 font-terminal text-[8px] text-muted-foreground">No sources are currently registered in this category. Use the actions above to add one.</div>;
}

export default function DataSourcesPanel({
  onConnectProvider,
  onImportFile,
  onAddDatabase,
  onAddStorage,
  onRefresh,
  onTestConnection,
  onEditConnection,
  onDeleteConnection,
}: DataSourcesPanelProps) {
  const [activeCategory, setActiveCategory] = useState<ConnectionCenterCategoryId>("data_providers");
  const [providerWizardOpen, setProviderWizardOpen] = useState(false);
  const [databaseDiscovery, setDatabaseDiscovery] = useState<{ connectionId: number; name: string } | null>(null);
  const query = useQuery<SourceRegistry>({
    queryKey: ["/api/setup/source-registry"],
    queryFn: async () => (await apiRequest("GET", "/api/setup/source-registry")).json(),
    staleTime: 30_000,
  });

  if (query.isLoading) return <div className="border border-border bg-[#070707] p-4 font-terminal text-[10px] text-muted-foreground" role="status">Loading Connection Center...</div>;

  if (query.isError || !query.data) {
    return <div className="border border-red-500/30 bg-red-500/5 p-4" role="alert"><p className="font-terminal text-[10px] text-red-400">Unable to load Connection Center sources.</p><button type="button" className="mt-2 border border-border px-2 py-1 font-terminal text-[8px] uppercase tracking-widest text-muted-foreground" onClick={() => query.refetch()}>Retry</button></div>;
  }

  const registry = query.data;
  const categoryItems = connectionCategoryItems(registry, activeCategory);
  const refresh = (): void => { onRefresh?.(); void query.refetch(); };

  return (
    <section className="border border-border bg-[#050505]" aria-labelledby="connection-center-heading">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-[#070707] px-4 py-3">
        <Plug className="h-4 w-4 text-[hsl(38,95%,55%)]" aria-hidden="true" />
        <div><h2 id="connection-center-heading" className="panel-label">CONNECTION CENTER</h2><p className="font-terminal text-[8px] uppercase tracking-widest text-muted-foreground">Connect your workspace · one setup surface for external and user-owned systems</p></div>
        <div className="ml-auto flex items-center gap-2 font-terminal text-[8px] uppercase tracking-widest text-muted-foreground"><span>{registry.summary.connectionCount} saved</span><span>{registry.summary.operationalCount} operational</span>{registry.summary.attentionCount > 0 && <span className="text-amber-400">{registry.summary.attentionCount} attention</span>}<button type="button" aria-label="Refresh Connection Center" className="border border-border p-1 text-muted-foreground" onClick={refresh}><RefreshCw className="h-3 w-3" aria-hidden="true" /></button></div>
      </div>

      <nav className="grid grid-cols-1 border-b border-border sm:grid-cols-5" aria-label="Connection categories">
        {CONNECTION_CENTER_CATEGORIES.map((category) => {
          const Icon = CATEGORY_ICONS[category.id];
          const count = connectionCategoryCount(registry, category.id);
          const active = activeCategory === category.id;
          return <button type="button" key={category.id} onClick={() => setActiveCategory(category.id)} aria-pressed={active} className={`border-b border-border px-3 py-3 text-left transition-colors sm:border-b-0 sm:border-r ${active ? "bg-[hsl(38,95%,50%)]/[0.08] text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:bg-white/[0.02] hover:text-foreground"}`}><div className="flex items-center gap-2"><Icon className="h-3.5 w-3.5" aria-hidden="true" /><span className="font-terminal text-[8px] font-bold uppercase tracking-wider">{category.label}</span></div><div className="mt-1 font-terminal text-[7px] uppercase tracking-wider opacity-70">{category.id === "communications" ? "reserved" : `${count} visible`}</div></button>;
        })}
      </nav>

      <div className="border-b border-border bg-[#070707] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="font-terminal text-[9px] font-bold uppercase tracking-wider text-foreground">{CONNECTION_CENTER_CATEGORIES.find((category) => category.id === activeCategory)?.label}</p><p className="mt-1 max-w-2xl font-terminal text-[8px] leading-relaxed text-muted-foreground">{CONNECTION_CENTER_CATEGORIES.find((category) => category.id === activeCategory)?.description}</p></div>
          <div className="flex flex-wrap gap-2">
            {activeCategory === "data_providers" && <><button type="button" className="border border-[hsl(38,95%,55%)]/50 bg-[hsl(38,95%,55%)]/[0.08] px-3 py-2 font-terminal text-[8px] font-bold uppercase tracking-widest text-[hsl(38,95%,55%)]" onClick={() => setProviderWizardOpen(true)}>+ Add Any Data Provider</button><button type="button" className="border border-border px-3 py-2 font-terminal text-[8px] uppercase tracking-widest text-muted-foreground hover:text-foreground" onClick={() => onConnectProvider()}>Built-in Providers</button></>}
            {activeCategory === "databases" && <button type="button" className="border border-[hsl(38,95%,55%)]/40 px-3 py-2 font-terminal text-[8px] uppercase tracking-widest text-[hsl(38,95%,55%)]" onClick={onAddDatabase}>+ Add Database</button>}
            {activeCategory === "files" && <><button type="button" className="flex items-center gap-1 border border-[hsl(38,95%,55%)]/40 px-3 py-2 font-terminal text-[8px] uppercase tracking-widest text-[hsl(38,95%,55%)]" onClick={onImportFile}><Upload className="h-3 w-3" /> Import File</button><button type="button" className="border border-border px-3 py-2 font-terminal text-[8px] uppercase tracking-widest text-muted-foreground" onClick={onAddStorage}>Add Storage</button></>}
          </div>
        </div>
      </div>

      <div className="grid gap-2 p-3 xl:grid-cols-2">
        {categoryItems.length > 0 ? categoryItems.map((item) => <SourceCard key={item.id} item={item} onConnectProvider={onConnectProvider} onTestConnection={onTestConnection} onEditConnection={onEditConnection} onDeleteConnection={onDeleteConnection} onDiscoverDatabase={(connectionId, name) => setDatabaseDiscovery({ connectionId, name })} />) : <div className="xl:col-span-2"><EmptyCategory category={activeCategory} /></div>}
      </div>

      <div className="border-t border-border px-4 py-2 font-terminal text-[7px] leading-relaxed text-muted-foreground/80">Connection status reflects the evidence available for each source: catalog availability, saved credentials, or a specific live verification. A saved credential alone does not prove that data is flowing or that an AI conversation succeeds.</div>

      {providerWizardOpen && <AddAnyDataProviderWizard onClose={() => setProviderWizardOpen(false)} onSaved={() => { setProviderWizardOpen(false); refresh(); }} />}
      {databaseDiscovery && <DatabaseDiscoveryBrowser connectionId={databaseDiscovery.connectionId} connectionName={databaseDiscovery.name} onClose={() => setDatabaseDiscovery(null)} />}
    </section>
  );
}
