import { useEffect, useState } from "react";
import { Terminal as TerminalIcon, TrendingUp, Landmark, Truck, Leaf, Megaphone, Palmtree } from "lucide-react";
import type { DomainInfo } from "@/lib/domains";
import { useAudience } from "@/lib/audience";

const DOMAIN_ICON: Record<string, typeof TrendingUp> = {
  finance: TrendingUp,
  economics_policy: Landmark,
  supply_chain: Truck,
  environment_sustainability: Leaf,
  marketing_pr: Megaphone,
  tourism_hospitality: Palmtree,
};

interface Props {
  session: { name: string };
  onChoose: (domain: DomainInfo) => void;
  onLogout: () => void;
}

export default function DomainPicker({ session, onChoose, onLogout }: Props) {
  const isClient = useAudience() === "client";
  const [domains, setDomains] = useState<DomainInfo[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    // The internal build lists every platform domain (including inactive
    // "coming soon" ones); the client build lists only what this org
    // actually subscribes to -- /api/admin/domains is internal-only and
    // would just 403 for a client session.
    fetch(isClient ? "/api/client/dashboard/domains" : "/api/admin/domains")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setDomains)
      .catch(() => setError(true));
  }, []);

  return (
    <div className="dark min-h-screen bg-[#030303] flex flex-col items-center justify-center px-6">
      <div className="flex items-center gap-2 mb-2">
        <TerminalIcon className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="font-terminal text-[13px] tracking-[0.25em] text-foreground uppercase">Limuria Intelligence</span>
      </div>
      <p className="font-terminal text-[10px] text-muted-foreground mb-10">
        Welcome back, {session.name.toUpperCase()}. Choose a workspace.
      </p>

      {error ? (
        <div className="font-terminal text-[10px] text-[hsl(0,80%,60%)]">Couldn't load workspaces. Refresh to try again.</div>
      ) : !domains ? (
        <div className="font-terminal text-[10px] text-muted-foreground animate-pulse">LOADING WORKSPACES...</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl w-full">
          {domains.map((d) => {
            const Icon = DOMAIN_ICON[d.slug] ?? TerminalIcon;
            return (
              <button
                key={d.id}
                disabled={!d.active}
                onClick={() => d.active && onChoose(d)}
                data-testid={`domain-tile-${d.slug}`}
                className={`flex flex-col items-center justify-center gap-3 aspect-square border p-6 transition-colors ${
                  d.active
                    ? "border-border hover:border-[hsl(38,95%,50%)]/60 hover:bg-white/5 cursor-pointer"
                    : "border-border/40 opacity-40 cursor-not-allowed"
                }`}
              >
                <Icon className={`w-7 h-7 ${d.active ? "text-[hsl(38,95%,55%)]" : "text-muted-foreground"}`} strokeWidth={1.5} />
                <span className="font-terminal text-[10px] tracking-widest text-center text-foreground uppercase">{d.name}</span>
                {!d.active && (
                  <span className="font-terminal text-[8px] tracking-widest text-muted-foreground uppercase">Coming Soon</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <button
        onClick={onLogout}
        className="mt-12 font-terminal text-[9px] tracking-widest text-muted-foreground hover:text-[hsl(0,80%,60%)] transition-colors uppercase"
      >
        Sign out
      </button>
    </div>
  );
}
