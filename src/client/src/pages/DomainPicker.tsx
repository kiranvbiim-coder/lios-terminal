import { useEffect, useState } from "react";
import { Terminal as TerminalIcon, TrendingUp, Landmark, Truck, Leaf } from "lucide-react";
import type { DomainInfo } from "@/lib/domains";
import { useAudience } from "@/lib/audience";

const DOMAIN_ICON: Record<string, typeof TrendingUp> = {
  finance: TrendingUp,
  economics_policy: Landmark,
  supply_chain: Truck,
  environment_sustainability: Leaf,
};

interface Props {
  session: { name: string };
  onChoose: (domain: DomainInfo) => void;
  onLogout: () => void;
  onCancel: () => void;
}

export default function DomainPicker({ session, onChoose, onLogout, onCancel }: Props) {
  const isClient = useAudience() === "client";
  const [domains, setDomains] = useState<DomainInfo[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setDomains(null); setError(false);
    fetch(isClient ? "/api/client/dashboard/domains" : "/api/admin/domains", { signal: controller.signal })
      .then(res => res.ok ? res.json() : Promise.reject(new Error("Workspaces unavailable")))
      .then((result: unknown) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result)) throw new Error("Invalid workspace response");
        setDomains((result as DomainInfo[]).filter((domain) => domain.active));
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [isClient, attempt]);

  return (
    <div className="dark min-h-screen bg-[#030303] flex flex-col items-center justify-center px-6">
      <button type="button" onClick={onCancel} className="mb-6 min-h-11 rounded border border-border px-4 py-2 font-ui text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Back to Chat</button>
      <div className="flex items-center gap-2 mb-2">
        <TerminalIcon className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="font-terminal text-[13px] tracking-[0.25em] text-foreground uppercase">LiOS Intelligence</span>
      </div>
      <h1 className="mt-4 font-display text-3xl text-foreground">Specialist workspaces</h1>
      <p className="mb-8 mt-3 max-w-xl font-ui text-sm leading-6 text-muted-foreground">
        Welcome, {session.name}. Specialist analysis is optional. Your Chat and unsent work remain available when you return.
      </p>

      {error ? (
        <div role="alert" className="rounded border border-rose-400/30 p-5 font-ui text-sm text-rose-300">Couldn't load specialist workspaces. Your current Chat is still available.
          <button type="button" onClick={() => setAttempt(value => value + 1)} className="ml-3 min-h-11 rounded border border-border px-4 py-2 text-foreground">Retry loading</button>
        </div>
      ) : !domains ? (
        <div role="status" className="font-ui text-sm text-muted-foreground">Loading specialist workspaces…</div>
      ) : domains.length === 0 ? (
        <div className="rounded border border-border p-5 font-ui text-sm text-muted-foreground">No specialist workspaces available.
          <button type="button" onClick={onCancel} className="ml-3 min-h-11 rounded border border-border px-4 py-2 text-foreground">Return to Chat</button>
        </div>
      ) : (
        <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
          {domains.map((d) => {
            const Icon = DOMAIN_ICON[d.slug] ?? TerminalIcon;
            return (
              <button
                key={d.id}
                onClick={() => onChoose(d)}
                data-testid={`domain-tile-${d.slug}`}
                aria-label={`Open ${d.name} workspace`}
                className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-3 rounded border border-border p-6 transition-colors hover:border-[hsl(38,95%,50%)]/60 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Icon className="w-7 h-7 text-[hsl(38,95%,55%)]" strokeWidth={1.5} />
                <span className="font-ui text-base font-semibold text-center text-foreground">{d.name}</span>
              </button>
            );
          })}
        </div>
      )}

      <button
        onClick={onLogout}
        className="mt-10 min-h-11 rounded px-4 py-2 font-ui text-sm text-muted-foreground hover:text-rose-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        Sign out
      </button>
    </div>
  );
}
