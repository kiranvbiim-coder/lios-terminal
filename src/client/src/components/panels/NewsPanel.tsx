import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import DataStatusBadge from "@/components/data/DataStatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import type { NewsItem } from "@/lib/finance";
import { useNewsArticle } from "@/lib/useFinance";

interface Props {
  symbol?: string;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export default function NewsPanel({ symbol }: Props) {
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [sentimentFilter, setSentimentFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const newsQuery = useQuery<{ items: NewsItem[]; returnedCount: number; knownCount: number; hasMore: boolean; page: number } | NewsItem[]>({
    queryKey: ["/api/finance/news", symbol ?? "market", query, page, from, to],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (symbol) params.set("symbol", symbol);
      if (query.trim()) params.set("query", query.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/finance/news?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 55000,
  });
  const newsPayload = newsQuery.data;
  const news = Array.isArray(newsPayload) ? newsPayload : newsPayload?.items ?? [];
  const isLoading = newsQuery.isLoading;
  const pagedNews = Array.isArray(newsPayload) ? null : newsPayload;
  const sources = useMemo(() => {
    return [
      "ALL",
      ...Array.from(new Set(news.map((item) => item.source.toUpperCase()))).sort(),
    ];
  }, [news]);

  const filtered = useMemo(() => {
    return news.filter((item: NewsItem) => {
      const sourceOk = sourceFilter === "ALL" || item.source.toUpperCase() === sourceFilter;
      const sentimentOk = sentimentFilter === "ALL" || item.sentiment === sentimentFilter.toLowerCase();
      return sourceOk && sentimentOk;
    });
  }, [news, sentimentFilter, sourceFilter]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedUrl(null);
      return;
    }

    if (!selectedUrl || !filtered.some((item) => item.url === selectedUrl)) {
      setSelectedUrl(filtered[0].url);
    }
  }, [filtered, selectedUrl]);

  const selectedItem = filtered.find((item) => item.url === selectedUrl) ?? null;
  const { data: article, isLoading: articleLoading } = useNewsArticle(selectedItem);
  const storySentiment = selectedItem?.sentiment ?? "neutral";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border bg-[#070707]">
        <div className="flex items-center gap-3 px-3 py-2 border-b border-border/70" data-workstation-toolbar>
          <div className="panel-label shrink-0">{symbol ? `${symbol} NEWS` : "MARKET NEWS"}</div>
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              placeholder="SEARCH HEADLINES OR SOURCE"
              className="w-full h-8 bg-black/30 border border-border pl-8 pr-3 font-terminal text-[10px] tracking-widest text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-[hsl(38,95%,50%)]"
              data-testid="news-search-input"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap px-2 py-1.5 border-b border-border/70">
          <label className="font-terminal text-[8px] text-muted-foreground">FROM <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="ml-1 bg-black/30 border border-border px-1 py-1 text-[8px]" /></label>
          <label className="font-terminal text-[8px] text-muted-foreground">TO <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="ml-1 bg-black/30 border border-border px-1 py-1 text-[8px]" /></label>
          <button type="button" disabled={page === 1 || isLoading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="px-2 py-1 font-terminal text-[8px] border border-border disabled:opacity-30">PREV</button>
          <button type="button" disabled={page === 1 || !pagedNews?.hasMore || isLoading} onClick={() => setPage((value) => value + 1)} className="px-2 py-1 font-terminal text-[8px] border border-border disabled:opacity-30">NEXT</button>
          <span className="ml-auto font-terminal text-[8px] text-muted-foreground">PAGE {page} · {pagedNews ? `${pagedNews.returnedCount}/${pagedNews.knownCount}` : `${news.length}`} RETURNED</span>
        </div>

        <div className="flex items-center gap-px overflow-x-auto scrollbar-thin px-2 py-1.5">
          {sources.map((source) => (
            <button
              key={source}
              onClick={() => setSourceFilter(source)}
              className={`px-2.5 py-1 font-terminal text-[9px] tracking-widest border border-border whitespace-nowrap transition-colors ${
                sourceFilter === source ? "bg-[hsl(38,95%,50%)/15%] text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {source}
            </button>
          ))}
          <div className="w-px h-5 bg-border mx-1" />
          {(["ALL", "positive", "negative", "neutral"] as const).map((state) => {
            const value = state === "ALL" ? "ALL" : state;
            const activeClass = state === "positive"
              ? "text-up"
              : state === "negative"
                ? "text-down"
                : "text-[hsl(38,95%,55%)]";
            return (
              <button
                key={state}
                onClick={() => setSentimentFilter(value)}
                className={`px-2 py-1 font-terminal text-[9px] tracking-widest border border-border whitespace-nowrap transition-colors ${
                  sentimentFilter === value ? activeClass : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {state === "ALL" ? "ALL" : state === "positive" ? "▲ POS" : state === "negative" ? "▼ NEG" : "○ NEU"}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="grid flex-1 min-h-0 min-w-0 overflow-hidden"
        data-news-readthrough-layout="responsive"
      >
        <div className="h-full overflow-y-auto scrollbar-thin bg-[#060606] border-r border-border" data-news-list="true" data-analytical-role="evidence">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array(6).fill(0).map((_, index) => <Skeleton key={index} className="h-24 bg-border" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center h-40 font-terminal text-muted-foreground text-xs">NO STORIES MATCH CURRENT FILTERS</div>
            ) : (
              filtered.map((item) => {
                const isActive = item.url === selectedUrl;
                return (
                  <button
                    key={item.url}
                    onClick={() => setSelectedUrl(item.url)}
                    className={`w-full text-left border-b border-border/60 p-4 transition-colors ${isActive ? "bg-[hsl(38,95%,50%)/8%] shadow-[inset_2px_0_0_hsl(38,95%,55%)]" : "hover:bg-white/5"}`}
                    data-testid={`news-item-${item.source.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    data-analytical-row
                  >
                    <div className="flex items-start gap-3">
                      <div className={`shrink-0 w-1.5 h-1.5 rounded-full mt-2 ${
                        item.sentiment === "positive" ? "bg-[hsl(142,71%,45%)]" :
                        item.sentiment === "negative" ? "bg-[hsl(0,80%,55%)]" :
                        "bg-[hsl(38,95%,55%)]"
                      }`} />
                      <div className="min-w-0 flex-1">
                        <div className="font-terminal text-sm text-foreground leading-snug line-clamp-2">{item.title}</div>
                        <div className="font-terminal text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-3">{item.summary}</div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="font-terminal text-[8px] px-1.5 py-0.5 border border-border text-[hsl(38,95%,55%)]">
                            {item.source.toUpperCase()}
                          </span>
                          <DataStatusBadge status={item.status} compact />
                          <span className="font-terminal text-[8px] text-muted-foreground">{relativeTime(item.publishedAt)}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        <div className="min-h-0 min-w-0 overflow-hidden">
          <div className="h-full min-w-0 overflow-y-auto scrollbar-thin bg-[#050505]" data-analytical-role="evidence">
            {!selectedItem ? (
              <div className="h-full flex items-center justify-center font-terminal text-xs text-muted-foreground">SELECT A STORY TO READ THROUGH</div>
            ) : articleLoading ? (
              <div className="p-5 space-y-3">
                <Skeleton className="h-7 w-2/3 bg-border" />
                <Skeleton className="h-4 w-32 bg-border" />
                {Array(6).fill(0).map((_, index) => <Skeleton key={index} className="h-4 w-full bg-border" />)}
              </div>
            ) : (
              <article className="p-5">
                <div className="flex items-start gap-3 justify-between">
                  <div>
                    <div className="panel-label mb-2">READ-THROUGH</div>
                    <h2 className="font-terminal text-lg text-foreground leading-tight max-w-3xl">{article?.title ?? selectedItem.title}</h2>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className="font-terminal text-[9px] px-1.5 py-0.5 border border-border text-[hsl(38,95%,55%)]">
                        {selectedItem.source.toUpperCase()}
                      </span>
                      <DataStatusBadge status={article?.status ?? selectedItem.status} compact showAsOf />
                      <span className="font-terminal text-[9px] text-muted-foreground">{relativeTime(selectedItem.publishedAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="lios-story-context" aria-label="Story analytical context">
                  {symbol && <span data-emphasis="object">OBJECT · {symbol.toUpperCase()}</span>}
                  <span>SOURCE · {selectedItem.source.toUpperCase()}</span>
                  <span data-emphasis={storySentiment === "positive" ? "positive" : storySentiment === "negative" ? "negative" : undefined}>
                    SENTIMENT · {storySentiment.toUpperCase()}
                  </span>
                  <span>AGE · {relativeTime(selectedItem.publishedAt).toUpperCase()}</span>
                </div>

                <p className="font-terminal text-[11px] text-muted-foreground leading-relaxed mt-4 pb-4 border-b border-border/60">
                  {article?.excerpt || selectedItem.summary}
                </p>

                <div className="mt-5 space-y-3">
                  {(article?.content.length ? article.content : [selectedItem.summary]).map((paragraph, index) => (
                    <p key={`${selectedItem.url}-${index}`} className="font-terminal text-[11px] text-foreground/95 leading-relaxed">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </article>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
