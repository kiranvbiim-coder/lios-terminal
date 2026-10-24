import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Bell, Zap, Terminal, KeyRound, Sparkles } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import type { DomainSlug } from "@/lib/domains";
import { getMarketStatus } from "@/lib/terminalChrome";
import { useAlerts } from "@/lib/useAlerts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getTerminalPersona, resolveTerminalPersonaId, type TerminalPersonaId } from "@/lib/terminalPersona";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import { useAudience } from "@/lib/audience";
import { isSecuritySearchResult, rankSecuritySearchResults, resolveVerifiedSecuritySelection, type SecuritySearchResult } from "@/lib/terminalSecuritySearch";

const PERSONA_PREFERENCES_KEY = ["/api/me/persona-preferences"] as const;
const LEGACY_PERSONA_KEYS = [
  "limuria-terminal-persona-v1",
  "lios-terminal-persona",
  "terminal-persona",
] as const;

interface PersonaPreferences {
  primaryPersona?: unknown;
  secondaryPersonas?: unknown;
  activeDomainSlug?: string | null;
  activeContext?: Record<string, unknown> | null;
  preferences?: Record<string, unknown>;
  [key: string]: unknown;
}

interface PersonaPreferencesResponse {
  preferences?: PersonaPreferences | null;
  selectedProfile?: unknown;
  availableProfiles?: unknown;
  hasPersistedPreferences?: boolean;
}

function readLegacyPersona(): string | null {
  if (typeof window === "undefined") return null;
  for (const key of LEGACY_PERSONA_KEYS) {
    try {
      const value = window.localStorage.getItem(key);
      if (value) return value;
    } catch {
      return null;
    }
  }
  return null;
}
function clearLegacyPersona(): void {
  if (typeof window === "undefined") return;
  try {
    LEGACY_PERSONA_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage can be unavailable in privacy-restricted contexts.
  }
}

function profileId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if ("id" in value && typeof value.id === "string") return value.id;
    if ("canonicalId" in value && typeof value.canonicalId === "string") return value.canonicalId;
  }
  return null;
}
export function shouldMigrateLegacyPersona(
  data: PersonaPreferencesResponse | undefined,
  legacyPersona: string | null,
): boolean {
  return Boolean(data && data.hasPersistedPreferences === false && legacyPersona);
}

function primaryPersona(data: PersonaPreferencesResponse | undefined): TerminalPersonaId {
  return resolveTerminalPersonaId(profileId(data?.preferences?.primaryPersona) ?? profileId(data?.selectedProfile) ?? readLegacyPersona());
}

function secondaryPersonas(data: PersonaPreferencesResponse | undefined): TerminalPersonaId[] {
  const values = Array.isArray(data?.preferences?.secondaryPersonas) ? data.preferences.secondaryPersonas : [];
  return values.map(profileId).filter((id): id is string => Boolean(id)).map(resolveTerminalPersonaId);
}

function personaOptions(data: PersonaPreferencesResponse | undefined): TerminalPersonaId[] {
  const available = Array.isArray(data?.availableProfiles)
    ? data.availableProfiles.map(profileId).filter((id): id is string => Boolean(id)).map(resolveTerminalPersonaId)
    : ["general" as TerminalPersonaId];
  return Array.from(new Set([primaryPersona(data), ...available]));
}

const DOMAIN_LABEL: Record<DomainSlug, string> = {
  finance: "FINANCE",
  economics_policy: "ECON & POLICY",
  supply_chain: "SUPPLY CHAIN",
  environment_sustainability: "ENVIRONMENT",
  marketing_pr: "MARKETING & PR",
  tourism_hospitality: "TOURISM",
  shared: "SHARED",
};

interface Props {
  activeSymbol: string;
  view: ViewMode;
  onNav: (v: ViewMode) => void;
  onSymbol: (sym: string) => void;
  onOpenCmd: () => void;
  onAskLios?: () => void;
  session?: { email: string; role: string; name: string; lifecycleStage?: "trial" | "client" | "churned" | null };
  onLogout?: () => void;
  domain?: DomainSlug;
  onSwitchDomain?: () => void;
}

function formatRelativeTime(value: string | Date | null) {
  if (!value) return "";
  const iso = typeof value === "string" ? value : value.toISOString();
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
export default function TopBar({ activeSymbol, view, onNav, onSymbol, onOpenCmd, onAskLios, session, onLogout, domain, onSwitchDomain }: Props) {
  const isClient = useAudience() === "client";
  const [searchVal, setSearchVal] = useState("");
  const [searchResults, setSearchResults] = useState<SecuritySearchResult[]>([]);
  const [completedSearch, setCompletedSearch] = useState<string | null>(null);
  const [searchingSecurity, setSearchingSecurity] = useState(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const queryClient = useQueryClient();
  const personaQuery = useQuery<PersonaPreferencesResponse>({
    queryKey: PERSONA_PREFERENCES_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/me/persona-preferences")).json(),
    retry: false,
  });
  const [personaId, setPersonaId] = useState<TerminalPersonaId>(() => primaryPersona(undefined));
  const migrationAttempted = useRef(false);
  const selectedPersonaId = primaryPersona(personaQuery.data);
  const availablePersonaIds = useMemo(() => personaOptions(personaQuery.data), [personaQuery.data]);
  const persona = getTerminalPersona(personaId);
  const personaMutation = useMutation<PersonaPreferencesResponse, Error, TerminalPersonaId, { previousPersonaId: TerminalPersonaId }>({
    mutationFn: async (id: TerminalPersonaId) => {
      const current = personaQuery.data?.preferences;
      const canonicalPrimary = getTerminalPersona(id).canonicalId;
      const canonicalSecondary = secondaryPersonas(personaQuery.data).map((secondary) => getTerminalPersona(secondary).canonicalId);
      const response = await apiRequest("PATCH", "/api/me/persona-preferences", {
        primaryPersona: canonicalPrimary,
        secondaryPersonas: canonicalSecondary,
        activeDomainSlug: current?.activeDomainSlug ?? undefined,
        activeContext: current?.activeContext ?? undefined,
        preferences: current?.preferences ?? {},
      });
      return response.json() as Promise<PersonaPreferencesResponse>;
    },
    onSuccess: async (data) => {
      clearLegacyPersona();
      queryClient.setQueryData(PERSONA_PREFERENCES_KEY, data);
      await queryClient.invalidateQueries({ queryKey: PERSONA_PREFERENCES_KEY });
    },
    onError: (_error, _id, context) => {
      setPersonaId(context?.previousPersonaId ?? selectedPersonaId);
    },
    onMutate: (id) => ({ previousPersonaId: personaId }),
  });

  useEffect(() => {
    const legacy = readLegacyPersona();
    if (!shouldMigrateLegacyPersona(personaQuery.data, legacy) || migrationAttempted.current) return;
    migrationAttempted.current = true;
    personaMutation.mutate(resolveTerminalPersonaId(legacy));
  }, [personaQuery.data, personaMutation]);

  useEffect(() => {
    if (!personaQuery.data || shouldMigrateLegacyPersona(personaQuery.data, readLegacyPersona())) return;
    setPersonaId(selectedPersonaId);
  }, [personaQuery.data, selectedPersonaId]);

  const choosePersona = (id: TerminalPersonaId) => {
    setPersonaId(id);
    personaMutation.mutate(id);
  };

  useEffect(() => {
    const query = searchVal.trim();
    if (!query) {
      setSearchResults([]);
      setCompletedSearch(null);
      setSearchingSecurity(false);
      return;
    }
    const controller = new AbortController();
    setSearchingSecurity(true);
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/finance/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Security lookup is unavailable");
        const payload: unknown = await response.json();
        const rows = Array.isArray(payload) ? payload.filter(isSecuritySearchResult) : [];
        if (!controller.signal.aborted) {
          setSearchResults(rankSecuritySearchResults(rows, query, 8));
          setCompletedSearch(query);
        }
      } catch {
        if (!controller.signal.aborted) {
          setSearchResults([]);
          setCompletedSearch(query);
          setSearchNotice("Security lookup unavailable. Check your connection and retry; no security was selected.");
        }
      } finally {
        if (!controller.signal.aborted) setSearchingSecurity(false);
      }
    }, 150);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [searchVal]);
  const [clock, setClock] = useState(() => new Date());
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const mktStatus = getMarketStatus(clock);
  const { data: alerts = [] } = useAlerts();

  const isTrial = isClient && session?.lifecycleStage === "trial";
  const triggeredAlerts = useMemo(() => {
    return alerts
      .filter((alert) => alert.triggered)
      .sort((a, b) => +new Date(b.triggeredAt ?? 0) - +new Date(a.triggeredAt ?? 0))
      .slice(0, 5);
  }, [alerts]);
  const activeAlertCount = alerts.filter((alert) => !alert.triggered).length;

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!notificationsOpen) return;

    const handleOutside = (event: MouseEvent) => {
      if (!notificationsRef.current?.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };

    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [notificationsOpen]);

  const chooseSecurity = (result: SecuritySearchResult) => {
    // A company name or typed ticker is only a query. The selected symbol must
    // be a validated row returned by this exact completed backend search.
    if (completedSearch?.trim().toUpperCase() !== searchVal.trim().toUpperCase() || !isSecuritySearchResult(result)) return;
    onSymbol(result.symbol.trim().toUpperCase());
    setSearchVal("");
    setSearchResults([]);
    setCompletedSearch(null);
    setSearchNotice(null);
    setIsFocused(false);
  };

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const resolved = resolveVerifiedSecuritySelection(searchVal, searchResults, completedSearch);
    if (resolved) chooseSecurity(resolved);
    else setSearchNotice(searchingSecurity
      ? "Searching securities. Choose a returned match after lookup finishes."
      : "No unique verified ticker matched. Choose an exact security from search results; the current workspace is unchanged.");
  };

  const timeStr = clock.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const dateStr = clock.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }).toUpperCase();

  return (
    <header className="flex items-center gap-0 h-9 min-w-0 bg-[#0a0a0a] border-b border-border shrink-0">
      <div className="flex shrink-0 items-center gap-2 px-2 sm:px-3 h-full border-r border-border bg-[hsl(38,95%,50%)] sm:min-w-[140px]">
        <Terminal className="w-3.5 h-3.5 text-black" strokeWidth={2.5} />
        <span className="hidden sm:inline font-terminal text-[10px] font-extrabold uppercase tracking-[0.08em] text-black">LiOS Terminal</span>
      </div>


      <div className="flex-1" />

      <div className="hidden 2xl:flex items-center gap-1.5 px-3 h-full border-r border-border">
        {mktStatus.pulse && (
          <div className="relative w-1.5 h-1.5">
            <div className={`absolute inset-0 rounded-full ${mktStatus.color === "text-up" ? "bg-[hsl(142,71%,45%)]" : "bg-[hsl(38,95%,50%)]"} animate-ping opacity-75`} />
            <div className={`w-1.5 h-1.5 rounded-full ${mktStatus.color === "text-up" ? "bg-[hsl(142,71%,45%)]" : "bg-[hsl(38,95%,50%)]"}`} />
          </div>
        )}
        <span className={`font-terminal text-[9px] tracking-widest font-semibold ${mktStatus.color}`}>{mktStatus.label}</span>
      </div>

      <button
        className="flex items-center gap-1.5 px-2.5 h-full border-r border-border hover:bg-white/5"
        onClick={() => onNav("entity")}
        data-testid="active-symbol"
      >
        <span className="hidden md:inline font-terminal text-[9px] text-muted-foreground">ACTIVE</span>
        <span className="font-terminal text-xs font-bold text-amber-500">{activeSymbol}</span>
      </button>

      {isClient ? (
        <div className="flex h-full items-center border-r border-border">
          <button
            type="button"
            onClick={onOpenCmd}
            className="flex h-full min-w-10 items-center gap-2 border-r border-border px-2.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground sm:px-3"
            data-testid="cmd-open"
            title="Search companies, data, tools or actions"
            aria-label="Open LiOS search"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden font-ui text-[9px] font-medium text-foreground/85 md:inline lg:hidden">SEARCH</span>
            <span className="hidden max-w-[220px] truncate font-ui text-[9px] text-muted-foreground lg:inline">Search companies, data or tools…</span>
            <kbd className="hidden rounded border border-border/70 px-1.5 py-0.5 font-ui text-[6px] text-muted-foreground/70 xl:inline">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => onAskLios ? onAskLios() : onNav("agent")}
            className="flex h-full items-center gap-1.5 px-2.5 font-ui text-[8px] font-semibold tracking-wide text-amber-300/90 transition-colors hover:bg-amber-400/[0.06] hover:text-amber-200 sm:px-3"
            data-testid="ask-lios"
            title="Open Ask LiOS"
            aria-label="Ask LiOS"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">ASK LIOS</span>
          </button>
        </div>
      ) : (
        <>
      <form onSubmit={handleSearch} className="hidden md:flex items-center h-full border-r border-border group relative">
        <div className="flex items-center gap-1.5 px-2.5">
          <Search className="w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            placeholder="FIND SECURITY"
            value={searchVal}
            onChange={(e) => { setSearchVal(e.target.value.toUpperCase()); setSearchResults([]); setCompletedSearch(null); setSearchNotice(null); }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className="bg-transparent font-terminal text-[10px] text-[hsl(38,95%,60%)] placeholder:text-muted-foreground/60 focus:outline-none w-24 uppercase"
            data-testid="ticker-search"
            aria-label="Search verified companies and securities"
            aria-describedby="lios-topbar-lookup-status"
          />
          {searchVal && (
            <button type="submit" className="font-terminal text-[8px] px-1.5 py-0.5 bg-[hsl(38,95%)] text-black rounded font-bold">
              GO
            </button>
          )}
        </div>

        {isFocused && completedSearch?.trim().toUpperCase() === searchVal.trim().toUpperCase() && searchResults.length > 0 && (
          <div
            onMouseDown={(e) => e.preventDefault()}
            className="absolute left-0 top-[35px] w-64 max-h-60 bg-[#090909] border border-border shadow-2xl overflow-y-auto scrollbar-thin z-50 py-1"
          >
            {searchResults.map((item, idx) => (
              <button type="button"
                key={`${item.symbol}:${item.exchange ?? ""}:${idx}`}
                onClick={() => chooseSecurity(item)}
                className="w-full text-left px-3 py-1.5 hover:bg-neutral-900 border-b border-border/20 last:border-b-0 flex items-center justify-between font-terminal"
              >
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-[hsl(38,95%,60%)]">{item.symbol}</span>
                  <span className="text-[8.5px] text-muted-foreground truncate max-w-[140px]">{item.name}</span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[8px] px-1 bg-white/5 border border-border/40 text-muted-foreground font-bold font-mono">
                    {item.exchange}{item.region ? ` · ${item.region}` : ""}
                  </span>
                  {item.assetClass && (
                    <span className="text-[6.5px] px-1 bg-amber-500/10 text-amber-500/80 font-bold font-mono rounded-none uppercase">
                      {item.assetClass}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
        {(isFocused || searchNotice) && searchVal.trim() && (
          <div id="lios-topbar-lookup-status" role="status" aria-live="polite" className="absolute left-0 top-full z-40 w-72 max-w-[90vw] border border-border bg-[#090909] px-3 py-2 font-ui text-xs leading-relaxed text-muted-foreground">
            {searchNotice ?? (searchingSecurity ? "Searching permitted security listings…" : completedSearch?.trim().toUpperCase() === searchVal.trim().toUpperCase() && searchResults.length === 0 ? "No matching securities returned by the source. Nothing was selected." : "Select a returned security. GO only opens one exact ticker match.")}
          </div>
        )}
      </form>

      <button
        onClick={onOpenCmd}
        className="flex items-center gap-1.5 px-2.5 h-full border-r border-border hover:bg-white/5 text-muted-foreground hover:text-foreground"
        data-testid="cmd-open"
      >
        <Zap className="w-3 h-3" />
        <span className="hidden sm:inline font-terminal text-[9px] tracking-widest">/CMD</span>
      </button>

        </>
      )}

      <div className="hidden sm:flex items-center h-full border-r border-border">
        <label htmlFor="terminal-persona-switcher" className="sr-only">Active persona</label>
        <select
          id="terminal-persona-switcher"
          data-testid="terminal-persona-switcher"
          value={personaId}
          disabled={personaMutation.isPending}
          onChange={(event) => choosePersona(event.target.value as TerminalPersonaId)}
          title={`${persona.label} — priority and navigation only`}
          className="h-full max-w-[150px] bg-transparent px-2 font-terminal text-[8px] tracking-wider text-[hsl(38,95%,60%)] outline-none hover:bg-white/5 disabled:opacity-60"
        >
          {availablePersonaIds.map((id) => {
            const profile = getTerminalPersona(id);
            return <option key={profile.canonicalId} value={profile.canonicalId} className="bg-[#090909] text-foreground">{profile.label}</option>;
          })}
        </select>
        {(personaQuery.isError || personaMutation.isError) && (
          <>
            <span role="status" className="sr-only">
              {personaMutation.isError ? "Persona preference could not be saved." : "Persona preferences are unavailable; using local defaults."}
            </span>
            <span aria-hidden="true" className="hidden xl:inline font-terminal text-[7px] text-red-300/85">{personaMutation.isError ? "SAVE ERR" : "OFFLINE"}</span>
            <span aria-hidden="true" className="mr-2 h-1.5 w-1.5 rounded-full bg-red-400" />
          </>
        )}
      </div>

      <div ref={notificationsRef} className="relative h-full border-r border-border">
        <button
          onClick={() => setNotificationsOpen((value) => !value)}
          className="relative flex items-center justify-center w-11 h-full hover:bg-white/5 text-muted-foreground hover:text-[hsl(38,95%,55%)]"
          data-testid="nav-alerts"
        >
          <Bell className="w-3.5 h-3.5" />
          {triggeredAlerts.length > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-4 h-4 px-1 rounded-full bg-[hsl(0,80%,55%)] text-[8px] leading-4 text-white font-terminal text-center">
              {triggeredAlerts.length}
            </span>
          )}
        </button>

        {notificationsOpen && (
          <div className="absolute right-0 top-full w-[340px] bg-[#090909] border border-border shadow-2xl z-50">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <div>
                <div className="panel-label">NOTIFICATION CENTER</div>
                <div className="font-terminal text-[8px] text-muted-foreground mt-1">
                  {activeAlertCount} ACTIVE · {triggeredAlerts.length} TRIGGERED
                </div>
              </div>
              <button
                onClick={() => { setNotificationsOpen(false); onNav("alerts"); }}
                className="font-terminal text-[8px] tracking-widest text-[hsl(38,95%,55%)] hover:text-foreground"
              >
                VIEW ALL
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto scrollbar-thin">
              {triggeredAlerts.length === 0 ? (
                <div className="px-3 py-6 font-terminal text-[10px] text-muted-foreground text-center">
                  NO TRIGGERED ALERTS
                </div>
              ) : (
                triggeredAlerts.map((alert) => (
                  <button
                    key={alert.id}
                    onClick={() => {
                      setNotificationsOpen(false);
                      onSymbol(alert.symbol);
                      onNav("quote");
                    }}
                    className="w-full text-left px-3 py-3 border-b border-border/60 hover:bg-white/5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-terminal text-[10px] font-bold text-[hsl(38,95%,55%)]">{alert.symbol}</span>
                      <span className={`font-terminal text-[9px] ${alert.condition === "above" ? "text-up" : "text-down"}`}>
                        {alert.condition === "above" ? "▲ ABOVE" : "▼ BELOW"}
                      </span>
                      <span className="font-terminal text-[9px] text-muted-foreground">${alert.price.toFixed(2)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-terminal text-[8px] text-muted-foreground">
                      {alert.triggerPrice !== null && <span>LAST ${alert.triggerPrice.toFixed(2)}</span>}
                      <span>{formatRelativeTime(alert.triggeredAt)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {isClient && isTrial && (
        <div
          className="flex items-center gap-1.5 px-2 sm:px-3 h-full border-r border-border font-terminal text-[8px] sm:text-[9px] tracking-wider bg-[hsl(38,95%,50%)/12%] text-[hsl(38,95%,55%)] shrink-0 max-w-[42vw] sm:max-w-none"
          data-testid="nav-import-licence-hint"
        >
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline 2xl:hidden">TRIAL</span><span className="hidden 2xl:inline">PRO TRIAL · Import a LiOS licence in Settings</span>
        </div>
      )}

      {domain && onSwitchDomain && (
        <button
          onClick={onSwitchDomain}
          className="hidden xl:flex items-center gap-1.5 px-3 h-full border-r border-border font-terminal text-[8.5px] tracking-widest text-[hsl(38,95%,60%)] hover:bg-white/5 transition-colors uppercase font-bold"
          title="Switch workspace domain"
          data-testid="switch-domain"
        >
          {DOMAIN_LABEL[domain]} <span className="text-muted-foreground normal-case">▾</span>
        </button>
      )}
      {session && (
        <div className="hidden 2xl:flex items-center gap-2 px-3 h-full border-r border-border font-terminal">
          <span className="text-[8.5px] bg-green-950/40 border border-green-800/60 text-green-500 font-bold px-2 py-0.5 tracking-widest uppercase">
            {session.role.replace("internal_", "").toUpperCase()}
          </span>

          {!isClient && (
            <button
              onClick={() => { setPasswordChanged(false); setShowChangePassword(true); }}
              className="text-[8.5px] hover:text-[hsl(38,95%,60%)] text-muted-foreground border border-border px-1.5 py-0.5 hover:bg-white/5 transition-colors uppercase font-bold flex items-center gap-1"
              title="Change your password"
            >
              <KeyRound className="w-2.5 h-2.5" /> PASSWORD
            </button>
          )}

          {onLogout && (
            <button
              onClick={onLogout}
              className="text-[8.5px] hover:text-red-400 text-muted-foreground border border-border px-1.5 py-0.5 hover:bg-red-950/10 hover:border-red-900/40 transition-colors uppercase font-bold animate-in fade-in duration-150"
            >
              DISCONNECT
            </button>
          )}
        </div>
      )}

      <div className="hidden lg:flex flex-col items-end justify-center px-3 h-full font-terminal">
        <span className="text-[10px] text-foreground tabular-nums">{timeStr}</span>
        <span className="text-[9px] text-muted-foreground">{dateStr}</span>
      </div>

      <Dialog open={showChangePassword} onOpenChange={setShowChangePassword}>
        <DialogContent className="bg-[#070707] border-border text-foreground font-terminal max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xs uppercase tracking-widest text-[hsl(38,95%,55%)]">Change Password</DialogTitle>
            <DialogDescription className="text-[9px] text-muted-foreground">
              {passwordChanged ? "Your password has been updated." : "Enter your current password and choose a new one."}
            </DialogDescription>
          </DialogHeader>
          {passwordChanged ? (
            <button
              onClick={() => setShowChangePassword(false)}
              className="w-full h-9 bg-[hsl(38,95%,50%)] hover:bg-[hsl(38,95%,45%)] text-black text-[10px] font-bold uppercase tracking-wider transition-colors duration-150"
            >
              Done
            </button>
          ) : (
            <ChangePasswordForm
              onSuccess={() => setPasswordChanged(true)}
              onCancel={() => setShowChangePassword(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </header>
  );
}
