import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, Terminal as TerminalIcon, TrendingUp, Landmark, Truck, Leaf, Megaphone, Palmtree } from "lucide-react";
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
  onCancel: () => void;
  onLogout: () => void;
}

/**
 * Specialist domains are optional destinations, never a gate before Chat.
 * Closing this picker leaves the mounted conversation/workspace untouched.
 */
export default function DomainPicker({ session, onChoose, onCancel, onLogout }: Props) {
  const isClient = useAudience() === "client";
  const [domains, setDomains] = useState<DomainInfo[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setDomains(null);
    setError(false);
    // A client sees entitled domains; the internal catalog includes inactive
    // future domains. Retrying must preserve the correct account endpoint.
    fetch(isClient ? "/api/client/dashboard/domains" : "/api/admin/domains", { signal: controller.signal })
      .then((res) => res.ok ? res.json() : Promise.reject(new Error("Unable to load workspaces")))
      .then((result: unknown) => {
        if (!controller.signal.aborted) setDomains(Array.isArray(result) ? result as DomainInfo[] : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [isClient, attempt]);

  return (
    <main className="dark flex min-h-[100dvh] w-full items-center justify-center overflow-y-auto bg-[#050505] px-4 py-8 font-ui text-foreground sm:px-6">
      <section className="w-full max-w-3xl">
        <button type="button" onClick={onCancel}
          className="mb-8 inline-flex min-h-11 items-center gap-2 rounded-md px-2 font-ui text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Chat
        </button>
        <div className="mb-2 flex items-center gap-2">
          <TerminalIcon className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="font-ui text-sm font-semibold text-foreground">LiOS</span>
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Specialist workspaces</h1>
        <p className="mt-2 max-w-2xl font-ui text-sm leading-6 text-muted-foreground">
          Choose a specialist area for professional analysis. Your regular Chat and saved work remain available; switching is optional.
        </p>
        <p className="mt-2 font-ui text-xs text-muted-foreground">Signed in as {session.name}</p>

        <div className="mt-8" aria-live="polite">
          {error ? (
            <section role="alert" className="rounded-xl border border-rose-400/25 bg-rose-400/[0.035] p-5">
              <h2 className="font-ui text-base font-semibold">Couldn't load specialist workspaces</h2>
              <p className="mt-2 font-ui text-sm leading-6 text-muted-foreground">
                Check your connection and try again. Your current Chat is still available.
              </p>
              <button type="button" onClick={() => setAttempt((value) => value + 1)}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-primary/40 px-4 py-2 font-ui text-sm font-semibold text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry loading
              </button>
            </section>
          ) : !domains ? (
            <p role="status" className="rounded-xl border border-border bg-[#090909] p-6 font-ui text-sm text-muted-foreground">Loading specialist workspaces…</p>
          ) : domains.length === 0 ? (
            <section className="rounded-xl border border-border bg-[#090909] p-6">
              <h2 className="font-ui text-base font-semibold">No specialist workspaces available</h2>
              <p className="mt-2 font-ui text-sm leading-6 text-muted-foreground">
                You can continue using Chat without choosing a specialist workspace.
              </p>
              <button type="button" onClick={onCancel} className="mt-4 min-h-11 rounded-md bg-primary px-4 py-2 font-ui text-sm font-semibold text-primary-foreground hover:bg-primary/90">Return to Chat</button>
            </section>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Available specialist workspaces">
              {domains.map((domain) => {
                const Icon = DOMAIN_ICON[domain.slug] ?? TerminalIcon;
                return (
                  <button type="button" key={domain.id} disabled={!domain.active}
                    onClick={() => { if (domain.active) onChoose(domain); }}
                    data-testid={`domain-tile-${domain.slug}`}
                    aria-label={domain.active ? `Open ${domain.name} workspace` : `${domain.name} workspace is coming soon`}
                    className={`flex min-h-36 flex-col items-start justify-between gap-5 rounded-xl border p-5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${domain.active
                      ? "border-border bg-[#090909] hover:border-primary/50 hover:bg-white/[0.035]"
                      : "cursor-not-allowed border-border/50 bg-[#080808] opacity-65"}`}>
                    <Icon className={`h-7 w-7 ${domain.active ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true" strokeWidth={1.5} />
                    <span className="font-ui text-base font-semibold text-foreground">{domain.name}</span>
                    {!domain.active && <span className="font-ui text-xs text-muted-foreground">Coming soon</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="mt-10 border-t border-border pt-4">
          <button type="button" onClick={onLogout}
            className="min-h-10 rounded-md px-2 font-ui text-sm text-muted-foreground hover:text-rose-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
