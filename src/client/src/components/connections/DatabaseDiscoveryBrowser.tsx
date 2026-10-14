import { useMemo, useState } from "react";
import { Database, Loader2, RefreshCw, Search, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface DiscoveredColumn {
  schema: string;
  table: string;
  name: string;
  dataType: string;
  nullable: boolean;
  ordinalPosition: number;
}

interface DiscoveredTable {
  schema: string;
  name: string;
  columns: DiscoveredColumn[];
}

interface DatabaseCatalogDiscovery {
  databaseType: "postgresql" | "mysql" | "sqlite" | "duckdb";
  tables: DiscoveredTable[];
  tableCount: number;
  columnCount: number;
  schemas: string[];
}

interface Props {
  connectionId: number;
  connectionName: string;
  onClose: () => void;
}

export default function DatabaseDiscoveryBrowser({ connectionId, connectionName, onClose }: Props) {
  const [catalog, setCatalog] = useState<DatabaseCatalogDiscovery | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const filteredTables = useMemo(() => {
    if (!catalog) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return catalog.tables;
    return catalog.tables.filter(table =>
      table.name.toLowerCase().includes(needle)
      || table.schema.toLowerCase().includes(needle)
      || table.columns.some(column => column.name.toLowerCase().includes(needle) || column.dataType.toLowerCase().includes(needle)),
    );
  }, [catalog, query]);

  const selectedTable = useMemo(() => {
    if (!catalog || !selectedKey) return null;
    return catalog.tables.find(table => `${table.schema}.${table.name}` === selectedKey) ?? null;
  }, [catalog, selectedKey]);

  async function discover(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest("POST", "/api/setup/source-connections/database/catalog", { connectionId });
      const result = await response.json() as DatabaseCatalogDiscovery;
      setCatalog(result);
      if (result.tables.length) setSelectedKey(current => current ?? `${result.tables[0].schema}.${result.tables[0].name}`);
    } catch (cause) {
      setCatalog(null);
      setError(cause instanceof Error ? cause.message : "Database catalog discovery failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <section className="flex max-h-[86vh] w-full max-w-5xl flex-col border border-border bg-[#070707] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="database-discovery-title" onClick={event => event.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-border p-4">
          <div>
            <div className="flex items-center gap-2"><Database className="h-4 w-4 text-[hsl(38,95%,55%)]" /><h2 id="database-discovery-title" className="font-terminal text-[11px] uppercase tracking-[0.16em] text-foreground">Database Discovery · {connectionName}</h2></div>
            <p className="mt-1 font-terminal text-[8px] leading-relaxed text-muted-foreground">Read-only metadata discovery for PostgreSQL, MySQL, SQLite and DuckDB. LiOS lists authorized schemas, tables, columns and native types without running write statements.</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close database discovery"><XCircle className="h-4 w-4" /></button>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <button type="button" onClick={() => void discover()} disabled={loading} className="inline-flex items-center gap-2 border border-[hsl(38,95%,55%)]/50 bg-[hsl(38,95%,55%)]/[0.06] px-3 py-2 font-terminal text-[8px] uppercase tracking-wider text-[hsl(38,95%,55%)] disabled:opacity-40">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : catalog ? <RefreshCw className="h-3 w-3" /> : <Search className="h-3 w-3" />}
            {loading ? "Discovering..." : catalog ? "Refresh Catalog" : "Discover Catalog"}
          </button>
          {catalog && <div className="flex flex-wrap gap-3 font-terminal text-[7px] uppercase tracking-wider text-muted-foreground"><span>{catalog.databaseType}</span><span>{catalog.schemas.length} schemas</span><span>{catalog.tableCount} tables</span><span>{catalog.columnCount} columns</span></div>}
        </div>

        {error && <div className="m-3 border border-rose-500/30 bg-rose-500/5 p-3 font-terminal text-[8px] text-rose-300" role="alert">{error}</div>}

        {!catalog && !error && <div className="p-8 text-center font-terminal text-[8px] text-muted-foreground">Run discovery to inspect the database catalog. Local SQLite/DuckDB sources do not require fabricated credentials; PostgreSQL/MySQL reuse the saved credential reference.</div>}

        {catalog && (
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[330px_1fr]">
            <aside className="min-h-0 overflow-y-auto border-r border-border p-3">
              <div className="relative mb-3"><Search className="absolute left-2 top-2.5 h-3 w-3 text-muted-foreground" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search schema, table, column..." className="w-full border border-border bg-[#0b0b0b] py-2 pl-7 pr-2 font-terminal text-[8px] text-foreground outline-none focus:border-[hsl(38,95%,50%)]/50" /></div>
              <div className="space-y-1">
                {filteredTables.map(table => {
                  const key = `${table.schema}.${table.name}`;
                  const active = selectedKey === key;
                  return <button type="button" key={key} onClick={() => setSelectedKey(key)} className={`w-full border px-2 py-2 text-left font-terminal ${active ? "border-[hsl(38,95%,50%)]/40 bg-[hsl(38,95%,50%)]/[0.06]" : "border-border bg-[#090909] hover:border-border/80"}`}><div className="truncate text-[8px] font-bold text-foreground">{table.name}</div><div className="mt-1 flex justify-between text-[7px] text-muted-foreground"><span>{table.schema}</span><span>{table.columns.length} cols</span></div></button>;
                })}
                {!filteredTables.length && <p className="border border-dashed border-border p-3 font-terminal text-[8px] text-muted-foreground">No catalog objects match the filter.</p>}
              </div>
            </aside>

            <main className="min-h-0 overflow-y-auto p-4">
              {selectedTable ? <>
                <div className="mb-3"><p className="font-terminal text-[10px] font-bold uppercase tracking-wider text-foreground">{selectedTable.schema}.{selectedTable.name}</p><p className="mt-1 font-terminal text-[7px] text-muted-foreground">Metadata only · {selectedTable.columns.length} discovered columns</p></div>
                <div className="overflow-x-auto border border-border">
                  <table className="w-full text-left font-terminal text-[8px]"><thead className="bg-[#0b0b0b] text-muted-foreground"><tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Column</th><th className="px-3 py-2">Native type</th><th className="px-3 py-2">Nullable</th></tr></thead><tbody>{selectedTable.columns.map(column => <tr key={`${column.ordinalPosition}:${column.name}`} className="border-t border-border/60"><td className="px-3 py-2 text-muted-foreground">{column.ordinalPosition}</td><td className="px-3 py-2 text-foreground">{column.name}</td><td className="px-3 py-2 text-muted-foreground">{column.dataType || "unknown"}</td><td className="px-3 py-2 text-muted-foreground">{column.nullable ? "yes" : "no"}</td></tr>)}</tbody></table>
                </div>
                <div className="mt-3 border border-cyan-500/20 bg-cyan-500/[0.03] p-3 font-terminal text-[7px] leading-relaxed text-cyan-200">Discovery does not create canonical mappings automatically. Saved deterministic field mappings belong to V4-07 and will consume this catalog metadata.</div>
              </> : <p className="font-terminal text-[8px] text-muted-foreground">Select a table to inspect its columns.</p>}
            </main>
          </div>
        )}
      </section>
    </div>
  );
}
