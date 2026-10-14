import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, RefreshCw, Terminal as TerminalIcon } from "lucide-react";
import type { PersonaId, PersonaProfile } from "@shared/personaRegistry";
import { PERSONA_REGISTRY, isPersonaId } from "@shared/personaRegistry";
import type { DomainInfo } from "@/lib/domains";
import { useAudience } from "@/lib/audience";
import { apiRequest } from "@/lib/queryClient";

const MAX_SECONDARY_PERSONAS = 3;

type Preferences = {
  primaryPersona?: PersonaId | null;
  secondaryPersonas?: PersonaId[] | null;
  activeDomainSlug?: string | null;
  activeContext?: Record<string, unknown> | null;
  preferences?: Record<string, unknown> | null;
};

export type PersonaPreferencesResponse = {
  preferences?: Preferences | null;
  selectedProfile?: PersonaProfile | PersonaId | null;
  availableProfiles?: Array<PersonaProfile | PersonaId>;
  securityRole?: string;
  onboardingCompleted?: boolean;
  hasPersistedPreferences?: boolean;
};

export interface PersonaOnboardingResult {
  activeDomain: DomainInfo | null;
  activeDomainSlug: string | null;
}

interface Props {
  session: { name: string; role?: string };
  onComplete: (result: PersonaOnboardingResult) => void;
  onLogout: () => void;
}

type ProfileOption = Pick<PersonaProfile, "id" | "label" | "description">;

function profileOption(value: unknown, role?: string): ProfileOption | null {
  const rawId = typeof value === "string" ? value : value && typeof value === "object" && "id" in value ? value.id : null;
  if (typeof rawId !== "string" || !isPersonaId(rawId)) return null;
  const canonical = PERSONA_REGISTRY[rawId];
  if (!canonical || (role && !canonical.allowedSecurityRoles.some((allowedRole) => allowedRole === role))) return null;
  const raw = value && typeof value === "object" ? value as Partial<PersonaProfile> : {};
  return {
    id: canonical.id,
    label: typeof raw.label === "string" ? raw.label : canonical.label,
    description: typeof raw.description === "string" ? raw.description : canonical.description,
  };
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export default function PersonaOnboarding({ session, onComplete, onLogout }: Props) {
  const isClient = useAudience() === "client";
  const [payload, setPayload] = useState<PersonaPreferencesResponse | null>(null);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [domains, setDomains] = useState<DomainInfo[] | null>(null);
  const [selectedPrimary, setSelectedPrimary] = useState<PersonaId | null>(null);
  const [selectedSecondary, setSelectedSecondary] = useState<PersonaId[]>([]);
  const [activeDomainSlug, setActiveDomainSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest("GET", "/api/me/persona-preferences");
      const next = await response.json() as PersonaPreferencesResponse;
      const options = Array.from(new Map(
        (next.availableProfiles ?? [])
          .map((profile) => profileOption(profile, session.role))
          .filter((profile): profile is ProfileOption => profile !== null)
          .map((profile) => [profile.id, profile] as const),
      ).values());
      const availableIds = new Set(options.map((profile) => profile.id));
      if (!options.length) throw new Error("No persona profiles are available for this account. Please contact your administrator.");
      setPayload(next);
      setProfiles(options);
      const preferences = next.preferences ?? {};
      const primary = preferences.primaryPersona && availableIds.has(preferences.primaryPersona) ? preferences.primaryPersona : options[0].id;
      const secondary = (preferences.secondaryPersonas ?? [])
        .filter((id): id is PersonaId => isPersonaId(id) && availableIds.has(id) && id !== primary)
        .slice(0, MAX_SECONDARY_PERSONAS);
      setSelectedPrimary(primary);
      setSelectedSecondary(secondary);
      setActiveDomainSlug(preferences.activeDomainSlug ?? null);
      if (next.onboardingCompleted) {
        onComplete({ activeDomain: null, activeDomainSlug: preferences.activeDomainSlug ?? null });
      }
    } catch (cause) {
      setError(errorMessage(cause, "We couldn't load persona options. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }, [onComplete]);

  const loadDomains = useCallback(async () => {
    setDomainError(null);
    try {
      const path = isClient ? "/api/client/dashboard/domains" : "/api/admin/domains";
      const response = await apiRequest("GET", path);
      setDomains(await response.json() as DomainInfo[]);
    } catch (cause) {
      setDomainError(errorMessage(cause, "Workspace options are temporarily unavailable."));
    }
  }, []);

  useEffect(() => {
    void loadPreferences();
    void loadDomains();
  }, [loadPreferences, loadDomains]);

  const selectedDomain = useMemo(
    () => domains?.find((domain) => domain.active && domain.slug === activeDomainSlug) ?? null,
    [activeDomainSlug, domains],
  );

  const toggleSecondary = (id: PersonaId) => {
    if (id === selectedPrimary) return;
    setSelectedSecondary((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < MAX_SECONDARY_PERSONAS ? [...current, id] : current);
  };

  const choosePrimary = (id: PersonaId) => {
    setSelectedPrimary(id);
    setSelectedSecondary((current) => current.filter((item) => item !== id));
  };

  const complete = async () => {
    if (!selectedPrimary || saving) return;
    setSaving(true);
    setError(null);
    try {
      const existing = payload?.preferences ?? {};
      const request: Record<string, unknown> = {
        primaryPersona: selectedPrimary,
        secondaryPersonas: selectedSecondary,
        activeContext: existing.activeContext ?? {},
        preferences: existing.preferences ?? {},
        complete: true,
      };
      if (activeDomainSlug) request.activeDomainSlug = activeDomainSlug;
      const response = await apiRequest("PATCH", "/api/me/persona-preferences", request);
      const saved = await response.json() as PersonaPreferencesResponse;
      const savedSlug = saved.preferences?.activeDomainSlug ?? activeDomainSlug;
      const savedDomain = domains?.find((domain) => domain.active && domain.slug === savedSlug) ?? null;
      onComplete({ activeDomain: savedDomain, activeDomainSlug: savedSlug });
    } catch (cause) {
      setError(errorMessage(cause, "We couldn't save your persona setup. Check your connection and try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dark h-screen min-h-screen overflow-y-auto bg-[#030303] flex flex-col items-center justify-start px-6 py-10 text-foreground">
      <div className="w-full max-w-3xl">
        <div className="flex items-center gap-2 mb-2">
          <TerminalIcon className="w-4 h-4 text-[hsl(38,95%,55%)]" />
          <span className="font-terminal text-[13px] tracking-[0.25em] uppercase">Limuria Intelligence</span>
        </div>
        <p className="font-terminal text-[10px] text-muted-foreground mb-8">Welcome, {session.name.toUpperCase()}. Tune your terminal for the work ahead.</p>

        {loading ? (
          <div className="flex items-center gap-2 font-terminal text-[10px] text-muted-foreground animate-pulse"><Loader2 className="w-3 h-3 animate-spin" /> LOADING PERSONA OPTIONS...</div>
        ) : error && !profiles.length ? (
          <div className="border border-[hsl(0,80%,60%)]/40 bg-[hsl(0,80%,60%)]/5 p-4 space-y-3">
            <p className="font-terminal text-[10px] text-[hsl(0,80%,65%)]">{error}</p>
            <button type="button" onClick={() => { void loadPreferences(); }} className="inline-flex items-center gap-2 border border-border px-3 py-2 font-terminal text-[9px] tracking-widest hover:border-[hsl(38,95%,50%)]/60 uppercase"><RefreshCw className="w-3 h-3" /> Retry</button>
          </div>
        ) : (
          <div className="space-y-8">
            <section>
              <div className="mb-3"><h1 className="font-terminal text-[11px] tracking-widest uppercase">Choose your primary lens</h1><p className="font-terminal text-[9px] text-muted-foreground mt-1">This changes prioritization and navigation, not your access or permissions.</p></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {profiles.map((profile) => {
                  const selected = selectedPrimary === profile.id;
                  return <button type="button" key={profile.id} aria-pressed={selected} onClick={() => choosePrimary(profile.id)} className={`text-left border p-4 transition-colors ${selected ? "border-[hsl(38,95%,50%)] bg-[hsl(38,95%,50%)]/10" : "border-border hover:border-[hsl(38,95%,50%)]/60 hover:bg-white/5"}`}><div className="flex items-start gap-3"><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${selected ? "border-[hsl(38,95%,50%)] text-[hsl(38,95%,55%)]" : "border-border"}`}>{selected && <Check className="w-3 h-3" />}</span><span><span className="block font-terminal text-[10px] tracking-widest uppercase">{profile.label}</span><span className="block mt-2 font-terminal text-[9px] leading-relaxed text-muted-foreground">{profile.description}</span></span></div></button>;
                })}
              </div>
            </section>

            <section>
              <div className="mb-3"><h2 className="font-terminal text-[11px] tracking-widest uppercase">Add supporting lenses <span className="text-muted-foreground">(optional, up to {MAX_SECONDARY_PERSONAS})</span></h2><p className="font-terminal text-[9px] text-muted-foreground mt-1">Select complementary perspectives for navigation and priority hints.</p></div>
              <div className="flex flex-wrap gap-2">
                {profiles.filter((profile) => profile.id !== selectedPrimary).map((profile) => { const selected = selectedSecondary.includes(profile.id); return <button type="button" key={profile.id} aria-pressed={selected} onClick={() => toggleSecondary(profile.id)} className={`border px-3 py-2 font-terminal text-[9px] tracking-widest uppercase transition-colors ${selected ? "border-[hsl(38,95%,50%)] text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10" : "border-border text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)]/60"}`}>{selected && <Check className="inline w-3 h-3 mr-1" />}{profile.label}</button>; })}
              </div>
            </section>

            <section>
              <div className="mb-3"><h2 className="font-terminal text-[11px] tracking-widest uppercase">Choose a starting workspace <span className="text-muted-foreground">(optional)</span></h2><p className="font-terminal text-[9px] text-muted-foreground mt-1">Only workspaces already available to your account are shown.</p></div>
              {domainError && <div className="mb-3 flex flex-wrap items-center gap-2 font-terminal text-[9px] text-[hsl(0,80%,65%)]"><span>{domainError} You can continue and choose one next.</span><button type="button" onClick={() => { void loadDomains(); }} className="inline-flex items-center gap-1 border border-border px-2 py-1 text-muted-foreground hover:text-foreground"><RefreshCw className="w-3 h-3" /> Retry</button></div>}
              {domains === null && !domainError ? <p className="font-terminal text-[9px] text-muted-foreground animate-pulse">LOADING WORKSPACES...</p> : <div className="flex flex-wrap gap-2">{(domains ?? []).map((domain) => <button type="button" key={domain.id} disabled={!domain.active} aria-pressed={activeDomainSlug === domain.slug} onClick={() => domain.active && setActiveDomainSlug((current) => current === domain.slug ? null : domain.slug)} className={`border px-3 py-2 font-terminal text-[9px] tracking-widest uppercase transition-colors ${!domain.active ? "border-border/40 text-muted-foreground/40 cursor-not-allowed" : activeDomainSlug === domain.slug ? "border-[hsl(38,95%,50%)] text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10" : "border-border text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)]/60"}`}>{domain.name}</button>)}</div>}
            </section>

            {error && <p role="alert" className="font-terminal text-[10px] text-[hsl(0,80%,65%)]">{error}</p>}
            <div className="flex items-center justify-between border-t border-border pt-5"><button type="button" onClick={onLogout} className="font-terminal text-[9px] tracking-widest text-muted-foreground hover:text-[hsl(0,80%,60%)] uppercase">Sign out</button><button type="button" disabled={!selectedPrimary || saving} onClick={() => { void complete(); }} className="inline-flex items-center gap-2 border border-[hsl(38,95%,50%)] bg-[hsl(38,95%,50%)]/10 px-4 py-2 font-terminal text-[10px] tracking-widest text-[hsl(38,95%,60%)] hover:bg-[hsl(38,95%,50%)]/20 disabled:opacity-50 uppercase">{saving && <Loader2 className="w-3 h-3 animate-spin" />} Continue to terminal</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
