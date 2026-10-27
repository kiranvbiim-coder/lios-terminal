import { useTerminalArtifactState, useTerminalArtifactContext } from "@/lib/terminalArtifactState";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import DataStatusBadge from "@/components/data/DataStatusBadge";
import NewsEditorialStoryCard from "./NewsEditorialStoryCard";
import { Skeleton } from "@/components/ui/skeleton";
import type { NewsItem } from "@/lib/finance";
import { useNewsArticle } from "@/lib/useFinance";
import type { CommonsCandidate } from "@shared/commonsMedia";
import { CommonsContextIllustration, NewsImageDiscovery } from "./NewsImageDiscovery";
import { LicensedEditorialImage } from "../terminal/LicensedEditorialImage";
import { NewsStoryEvolution } from "./NewsStoryEvolution";
import { safePulseSourceUrl } from "@/lib/pulseStoryPresentation";
import { observeNewsFeed, type NewsStoryRevision } from "@/lib/newsStoryEvolution";
import { approvedPhotoCount, newsWithApprovedPhotos } from "@/lib/newsVisualCoverage";
import { readSavedNewsIllustrations, rememberNewsIllustration, forgetNewsIllustration, restoredNewsIllustration, type SavedNewsIllustration } from "@/lib/newsIllustrationSelections";

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
  const panelOwner = useTerminalArtifactContext();
  const canRememberIllustrations = Boolean(panelOwner && !panelOwner.readOnly);
  const [sourceFilter, setSourceFilter] = useTerminalArtifactState("NewsPanel.sourceFilter", "ALL");
  const [sentimentFilter, setSentimentFilter] = useTerminalArtifactState("NewsPanel.sentimentFilter", "ALL");
  const [query, setQuery] = useTerminalArtifactState("NewsPanel.query", "");
  const [selectedUrl, setSelectedUrl] = useTerminalArtifactState<string | null>("NewsPanel.selectedUrl", null);
  const [page, setPage] = useTerminalArtifactState("NewsPanel.page", 1);
  const [from, setFrom] = useTerminalArtifactState("NewsPanel.from", "");
  const [to, setTo] = useTerminalArtifactState("NewsPanel.to", "");
  // Only explicitly remembered image REFERENCES live in the existing P4
  // authored panel state. Preview pixels are NEVER cached here or restored
  // automatically: reopening requires a live user-triggered Commons CC0 check.
  const [savedImageState, setSavedImageState] = useTerminalArtifactState<SavedNewsIllustration[]>("NewsPanel.rememberedContextIllustrations", []);
  const savedIllustrations = useMemo(() => readSavedNewsIllustrations(savedImageState), [savedImageState]);
  const [contextImage, setContextImage] = useState<{ storyUrl: string; candidate: CommonsCandidate } | null>(null);
  const [photoOnly, setPhotoOnly] = useState(false);
  // Only real successive feed observations while this view is mounted.
  const [observedRevisions, setObservedRevisions] = useState<NewsStoryRevision[]>([]);
  const activeNewsStoryRef = useRef<string | null>(null);
  const recheckGenerationRef = useRef(0);
  useEffect(() => () => { recheckGenerationRef.current++; }, []);

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
  useEffect(() => {
    if (!newsQuery.isSuccess || !newsQuery.dataUpdatedAt) return;
    setObservedRevisions(current => observeNewsFeed(current, news, newsQuery.dataUpdatedAt));
  }, [newsQuery.isSuccess, newsQuery.dataUpdatedAt, newsQuery.data]);
  const pagedNews = Array.isArray(newsPayload) ? null : newsPayload;
  const sources = useMemo(() => {
    return [
      "ALL",
      ...Array.from(new Set(news.map((item) => item.source.toUpperCase()))).sort(),
    ];
  }, [news]);

  const licensedPhotoCount = useMemo(() => approvedPhotoCount(news, new Date().toISOString()), [news]);
  const filtered = useMemo(() => {
    const sourceAndSentiment = news.filter((item: NewsItem) => {
      const sourceOk = sourceFilter === "ALL" || item.source.toUpperCase() === sourceFilter;
      const sentimentOk = sentimentFilter === "ALL" || item.sentiment === sentimentFilter.toLowerCase();
      return sourceOk && sentimentOk;
    });
    return photoOnly ? newsWithApprovedPhotos(sourceAndSentiment, new Date().toISOString()) : sourceAndSentiment;
  }, [news, sentimentFilter, sourceFilter, photoOnly]);

  useEffect(() => {
    if (!newsQuery.isSuccess || newsQuery.isFetching || newsQuery.isError || selectedUrl || !filtered.length) return;
    setSelectedUrl(filtered[0].url);
  }, [filtered, selectedUrl, newsQuery.isSuccess, newsQuery.isFetching, newsQuery.isError]);

  const selectedItem = filtered.find((item) => item.url === selectedUrl) ?? null;
  // Invalidate image rechecks whenever a committed reader target changes,
  // including A → B → A and restored artifact selections. Never mutate refs
  // during render: discarded concurrent renders must not change permissions.
  const selectedStoryUrl = selectedItem?.url ?? null;
  useEffect(() => {
    if (activeNewsStoryRef.current !== selectedStoryUrl) {
      recheckGenerationRef.current++;
      activeNewsStoryRef.current = selectedStoryUrl;
    }
  }, [selectedStoryUrl]);
  const { data: article, isLoading: articleLoading } = useNewsArticle(selectedItem);
  const storySentiment = selectedItem?.sentiment ?? "neutral";
  const selectedSourceHref = selectedItem ? safePulseSourceUrl(selectedItem.url) : null;
  const selectedContextImage = selectedItem && contextImage?.storyUrl === selectedItem.url && !selectedItem.media ? contextImage.candidate : null;
  const savedSelection = selectedItem && !selectedItem.media
    ? savedIllustrations.find(saved => saved.storyUrl === selectedItem.url) ?? null : null;
  const rememberSelected = () => {
    if (!canRememberIllustrations || !selectedItem || !selectedContextImage) return;
    setSavedImageState(previous => rememberNewsIllustration(previous, selectedItem.url, selectedContextImage));
  };
  const forgetSelected = () => {
    recheckGenerationRef.current++;
    if (!canRememberIllustrations || !selectedItem) return;
    setSavedImageState(previous => forgetNewsIllustration(previous, selectedItem.url));
  };
  const reopenSaved = async (): Promise<boolean> => {
    if (!savedSelection || !selectedItem || !canRememberIllustrations) return false;
    const requestedStory = selectedItem.url;
    const generation = ++recheckGenerationRef.current;
    const response = await fetch("/api/media/commons/cc0/file?title=" + encodeURIComponent(savedSelection.candidate.fileTitle), {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return false;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return false;
    const record = payload as { status?: unknown; candidate?: unknown };
    if (record.status !== "unreviewed") return false;
    if (generation !== recheckGenerationRef.current || activeNewsStoryRef.current !== requestedStory) return false;
    const candidate = restoredNewsIllustration(savedSelection, record.candidate as CommonsCandidate);
    if (!candidate) return false;
    setContextImage({ storyUrl: requestedStory, candidate });
    return true;
  };

  const missingSelection = selectedUrl !== null && !selectedItem && newsQuery.isSuccess && !newsQuery.isFetching;
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
          <button type="button" disabled={!pagedNews?.hasMore || page >= 52 || isLoading || newsQuery.isFetching} onClick={() => setPage((value) => Math.min(52, value + 1))} className="px-2 py-1 font-terminal text-[8px] border border-border disabled:opacity-30">NEXT</button>
          <span className="ml-auto font-terminal text-[8px] text-muted-foreground">PAGE {page} · {pagedNews ? `${pagedNews.returnedCount}/${pagedNews.knownCount}` : `${news.length}`} RETURNED</span>
        </div>

        <div className="flex items-center gap-px overflow-x-auto scrollbar-thin px-2 py-1.5">
          <button type="button" aria-pressed={photoOnly} onClick={() => setPhotoOnly(value => !value)}
            disabled={licensedPhotoCount === 0 && !photoOnly}
            className="mr-2 shrink-0 border border-border px-2.5 py-1 font-terminal text-[9px] tracking-wider text-amber-200 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-amber-300">
            VERIFIED PHOTOS {licensedPhotoCount}
          </button>
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
        <div className="h-full space-y-2 overflow-y-auto scrollbar-thin border-r border-border bg-[#060606] p-3" data-news-list="true" data-analytical-role="evidence">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array(6).fill(0).map((_, index) => <Skeleton key={index} className="h-24 bg-border" />)}
              </div>
            ) : newsQuery.isError ? (
              <div role="alert" className="space-y-3 p-4 font-ui text-sm text-muted-foreground">
                <p>News could not be fetched. Check the date filters or source connection.</p>
                <button type="button" onClick={() => void newsQuery.refetch()}
                  className="min-h-10 rounded border border-border px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-amber-300">
                  Retry news
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center h-40 font-terminal text-muted-foreground text-xs">{photoOnly ? "NO RIGHTS-VERIFIED PHOTOS MATCH THIS FEED" : "NO STORIES MATCH CURRENT FILTERS"}</div>
            ) : (
              filtered.map((item, index) => (
                <NewsEditorialStoryCard
                  key={item.url}
                  title={item.title}
                  summary={item.summary}
                  source={item.source}
                  publishedAt={item.publishedAt}
                  ageLabel={relativeTime(item.publishedAt)}
                  sentiment={item.sentiment}
                  statusBadge={<DataStatusBadge status={item.status} compact />}
                  media={item.media}
                  sourceEvidenceId={item.url}
                  contextIllustration={!item.media && contextImage?.storyUrl === item.url ? contextImage.candidate : undefined}
                  active={item.url === selectedUrl}
                  lead={index === 0}
                  onSelect={() => {
                    recheckGenerationRef.current++;
                    setSelectedUrl(item.url);
                  }}
                />
              ))
            )}
          </div>
        <div className="min-h-0 min-w-0 overflow-hidden">
          <div className="h-full min-w-0 overflow-y-auto scrollbar-thin bg-[#050505]" data-analytical-role="evidence">
            {!selectedItem ? (
              <div role="status" className="h-full flex items-center justify-center font-terminal text-xs text-muted-foreground">{missingSelection ? "The saved story is unavailable in the current source/filter results. Its reference is preserved; choose another story explicitly." : newsQuery.isError ? "News source unavailable. Saved story selection is unchanged." : "SELECT A STORY TO READ THROUGH"}</div>
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
                    <h2 className="max-w-3xl font-ui text-xl font-semibold leading-snug text-foreground sm:text-2xl">{article?.title ?? selectedItem.title}</h2>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className="font-terminal text-[9px] px-1.5 py-0.5 border border-border text-[hsl(38,95%,55%)]">
                        {selectedItem.source.toUpperCase()}
                      </span>
                      <DataStatusBadge status={article?.status ?? selectedItem.status} compact showAsOf />
                      {selectedSourceHref && (
                        <a href={selectedSourceHref} target="_blank" rel="noopener noreferrer"
                          referrerPolicy="no-referrer"
                          className="font-ui text-xs text-amber-200 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-amber-300">
                          Read original publisher
                        </a>
                      )}
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

                {selectedItem.media
                  ? <LicensedEditorialImage media={selectedItem.media} sourceIds={[selectedItem.url]} className="my-4" />
                  : selectedContextImage ? <CommonsContextIllustration candidate={selectedContextImage} showSource /> : null}
                <NewsImageDiscovery key={selectedItem.url} articleTitle={selectedItem.title}
                  selected={selectedContextImage}
                  onSelect={candidate => { recheckGenerationRef.current++; setContextImage({ storyUrl: selectedItem.url, candidate }); }}
                  onClear={() => { recheckGenerationRef.current++; setContextImage(null); }}
                  canRemember={canRememberIllustrations}
                  saved={savedSelection}
                  onRemember={rememberSelected}
                  onForget={forgetSelected}
                  onReopenSaved={reopenSaved} />

                <p className="mt-4 border-b border-border/60 pb-4 font-ui text-sm leading-6 text-muted-foreground">
                  {article?.excerpt || selectedItem.summary}
                </p>

                <NewsStoryEvolution exactUrl={selectedItem.url} history={observedRevisions} />

                <div className="mt-5 space-y-3">
                  {(article?.content.length ? article.content : [selectedItem.summary]).map((paragraph, index) => (
                    <p key={`${selectedItem.url}-${index}`} className="max-w-prose font-ui text-sm leading-7 text-foreground/95">
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
