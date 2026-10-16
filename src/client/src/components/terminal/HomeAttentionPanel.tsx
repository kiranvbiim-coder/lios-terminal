import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ActionInboxItem, IntelligenceCard } from "@shared/waveDContracts";

interface HomeAttention {
  cards: IntelligenceCard[];
  actionInbox: ActionInboxItem[];
}

export function HomeAttentionPanel() {
  const [open, setOpen] = useState(false);
  return <details className="mt-3 rounded border border-border/50 p-3" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-ui text-sm font-medium">Home-wide attention</summary>
    <p className="mt-2 text-xs text-muted-foreground">This is your Home-wide watchlist and saved intelligence, not only this Project. Review, snooze or reopen material items. These controls never approve a Decision or execute work.</p>
    {open && <HomeAttentionContents />}
  </details>;
}

function HomeAttentionContents() {
  const queryClient = useQueryClient();
  const [visibleCount, setVisibleCount] = useState(12);
  const query = useQuery<HomeAttention>({
    queryKey: ["/api/wave-d/pulse"],
    queryFn: async () => (await apiRequest("GET", "/api/wave-d/pulse")).json(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const mutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ActionInboxItem["status"] }) => {
      await apiRequest("POST", `/api/wave-d/action-inbox/${encodeURIComponent(id)}`, { status });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/wave-d/pulse"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/wave-d/action-inbox"] }),
      ]);
    },
  });
  const items = new Map((query.data?.actionInbox ?? []).map(item => [item.sourceCardId, item]));
  const materialCards = (query.data?.cards ?? []).filter(card => card.priority !== "fyi" || items.has(card.id));
  const cards = materialCards.slice(0, visibleCount);
  const disabled = mutation.isPending || query.isError;
  return <div className="mt-3 space-y-3">
    <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="rounded border border-border/60 px-2 py-1 text-xs disabled:opacity-40">Refresh Home attention</button>
    {query.isPending && <p role="status" className="text-xs text-muted-foreground">Reading current Home attention…</p>}
    {query.isError && <p role="alert" className="text-xs text-amber-200">Home attention could not be refreshed. No new state is inferred; refresh before changing an item.</p>}
    {mutation.isError && <p role="alert" className="text-xs text-amber-200">{mutation.error instanceof Error ? mutation.error.message : "Attention update failed."}</p>}
    {query.isSuccess && !cards.length && <p className="text-xs text-muted-foreground">No material items currently need review.</p>}
    {cards.map(card => {
      const inbox = items.get(card.id);
      const status = inbox?.status ?? (card.status === "unread" ? "open" : "resolved");
      const update = (next: ActionInboxItem["status"]) => mutation.mutate({ id: inbox?.id ?? `inbox:${card.id}`, status: next });
      return <article key={card.id} className="space-y-2 rounded border border-border/50 p-3">
        <h4 className="font-ui text-sm font-medium">{card.title}</h4>
        <p className="text-xs text-muted-foreground">{card.whatHappened}</p>
        <p className="text-xs text-muted-foreground">{card.whyItMattersToUser}</p>
        <p className="text-xs text-muted-foreground">{status === "resolved" ? "Reviewed" : status === "snoozed" ? "Snoozed until you reopen it" : "Awaiting your review"} · {card.createdAt}</p>
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Source evidence</summary>
          {card.evidence.length ? <ul className="mt-2 space-y-1">{card.evidence.map((source, index) => <li key={`${source.id}:${index}`}>
            {source.source}{source.provider ? ` · ${source.provider}` : ""}{source.availableAt ? ` · ${source.availableAt}` : ""}
            {source.url && /^https?:\/\//i.test(source.url) && <> · <a className="underline" href={source.url} target="_blank" rel="noreferrer">Open source</a></>}
          </li>)}</ul> : <p className="mt-2">No attributed source evidence is attached. Inspect the underlying work before changing a decision.</p>}
        </details>
        <div className="flex flex-wrap gap-2">
          {status === "open" ? <>
            <button type="button" disabled={disabled} onClick={() => update("resolved")} className="rounded border border-border/60 px-2 py-1 text-xs disabled:opacity-40">Mark reviewed</button>
            <button type="button" disabled={disabled} onClick={() => update("snoozed")} className="rounded border border-border/60 px-2 py-1 text-xs disabled:opacity-40">Snooze</button>
          </> : <button type="button" disabled={disabled} onClick={() => update("open")} className="rounded border border-border/60 px-2 py-1 text-xs disabled:opacity-40">Reopen for review</button>}
        </div>
      </article>;
    })}
    {cards.length < materialCards.length && <button type="button" onClick={() => setVisibleCount(count => count + 12)} className="rounded border border-border/60 px-2 py-1 text-xs">Show more attention items</button>}
  </div>;
}
