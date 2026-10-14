import { useQuery } from "@tanstack/react-query";

export interface MediaQuote {
  topicId: string;
  name: string;
  unit: string;
  value: number | null;
  previousValue: number | null;
  change: number | null;
  changePercent: number | null;
  asOf: string | null;
  isLive: boolean;
}

export interface MediaDetail {
  quote: MediaQuote;
  history: { date: string; value: number }[];
  volume: { date: string; value: number }[];
  wikipediaArticle: string | null;
}

export interface PageviewObservation { date: string; views: number }
export interface PageviewResult { article: string; history: PageviewObservation[]; isLive: boolean }

export function useWikipediaPageviews(article: string | null) {
  return useQuery<PageviewResult>({
    queryKey: ["/api/wikipedia/pageviews", article],
    queryFn: async () => {
      const res = await fetch(`/api/wikipedia/pageviews/${article}`);
      if (!res.ok) throw new Error("Failed to fetch Wikipedia pageviews");
      return res.json();
    },
    enabled: !!article,
  });
}

export function useMediaTopics() {
  return useQuery<MediaQuote[]>({
    queryKey: ["/api/media/topics"],
    queryFn: async () => {
      const res = await fetch("/api/media/topics");
      if (!res.ok) throw new Error("Failed to fetch media topics");
      return res.json();
    },
    refetchInterval: 300000,
    staleTime: 120000,
  });
}

export function useMediaTopicDetail(topicId: string) {
  return useQuery<MediaDetail>({
    queryKey: ["/api/media/topic", topicId],
    queryFn: async () => {
      const res = await fetch(`/api/media/topic/${topicId}`);
      if (!res.ok) throw new Error("Failed to fetch media topic detail");
      return res.json();
    },
    enabled: !!topicId,
  });
}
