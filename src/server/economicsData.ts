import { buildDataStatus, type DataStatus } from "./dataStatus";
import { fetchText, getCached, setCached } from "./providerUtils";

export type EconomicEventCategory = "inflation" | "labor" | "growth" | "policy" | "consumption" | "activity" | "housing";
export type EconomicEventImportance = "high" | "medium";

export interface EconomicCalendarEvent {
  id: string;
  releaseId: number;
  title: string;
  category: EconomicEventCategory;
  importance: EconomicEventImportance;
  date: string;
  timeCt: string;
  releaseUrl: string;
  status: DataStatus;
}

export interface EconomicReleaseTable {
  title: string;
  url: string;
  recordCount: number | null;
}

export interface EconomicReleaseScheduleDate {
  date: string;
  timeCt: string;
}

export interface EconomicEventDetail {
  releaseId: number;
  title: string;
  category: EconomicEventCategory;
  importance: EconomicEventImportance;
  sourceName: string;
  sourceUrl: string | null;
  releaseCalendarUrl: string;
  releaseWebsiteUrl: string | null;
  tables: EconomicReleaseTable[];
  upcomingDates: EconomicReleaseScheduleDate[];
  status: DataStatus;
}

const FRED_BASE_URL = "https://fred.stlouisfed.org";
const CALENDAR_WINDOW_DAYS = 30;
const CALENDAR_TTL_MS = 15 * 60_000;
const DETAIL_TTL_MS = 60 * 60_000;

const calendarCache = new Map<string, { expiresAt: number; value: EconomicCalendarEvent[] }>();
const detailCache = new Map<string, { expiresAt: number; value: EconomicEventDetail }>();

const TRACKED_RELEASES: Array<{
  pattern: RegExp;
  category: EconomicEventCategory;
  importance: EconomicEventImportance;
}> = [
  { pattern: /consumer price index/i, category: "inflation", importance: "high" },
  { pattern: /producer price index/i, category: "inflation", importance: "medium" },
  { pattern: /employment situation/i, category: "labor", importance: "high" },
  { pattern: /gross domestic product/i, category: "growth", importance: "high" },
  { pattern: /personal income and outlays/i, category: "growth", importance: "medium" },
  { pattern: /advance monthly sales for retail and food services/i, category: "consumption", importance: "medium" },
  { pattern: /industrial production and capacity utilization/i, category: "activity", importance: "medium" },
  { pattern: /housing starts/i, category: "housing", importance: "medium" },
  { pattern: /new residential sales/i, category: "housing", importance: "medium" },
  { pattern: /fomc press release/i, category: "policy", importance: "high" },
  { pattern: /summary of economic projections/i, category: "policy", importance: "high" },
];

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function toAbsoluteFredUrl(path: string | null | undefined) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return decodeHtml(path);
  return `${FRED_BASE_URL}${decodeHtml(path)}`;
}

function classifyRelease(title: string) {
  return TRACKED_RELEASES.find((entry) => entry.pattern.test(title)) ?? null;
}

function normalizeCtTime(raw: string) {
  const value = stripTags(raw).toUpperCase();
  if (!value || value === "N/A") return null;
  return `${value.replace(/\s+/g, " ")} CT`;
}

function parseMinutes(timeCt: string) {
  const match = timeCt.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)\s+CT$/);
  if (!match) return Number.POSITIVE_INFINITY;
  const hour12 = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3];
  const hour24 = meridiem === "PM"
    ? (hour12 % 12) + 12
    : hour12 % 12;
  return hour24 * 60 + minute;
}

function toIsoDate(label: string) {
  const parsed = new Date(`${label} 12:00 UTC`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Unable to parse calendar date: ${label}`);
  }
  return parsed.toISOString().slice(0, 10);
}

function parseCalendarRows(html: string, onEvent: (payload: { date: string; timeCt: string | null; releaseId: number; title: string; }) => void) {
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let currentDate = "";
  let match = rowRegex.exec(html);

  while (match) {
    const row = match[1];
    const dateMatch = row.match(/<span[^>]*font-weight:\s*bold;?[^>]*>([^<]+)<\/span>/i);
    if (dateMatch) {
      currentDate = toIsoDate(dateMatch[1].trim());
      match = rowRegex.exec(html);
      continue;
    }

    const releaseMatch = row.match(/<a[^>]+href="\/release\?rid=(\d+)"[^>]*>([^<]+)<\/a>/i);
    if (releaseMatch && currentDate) {
      const timeMatch = row.match(/<td[^>]*nowrap[^>]*>([\s\S]*?)<\/td>/i);
      onEvent({
        date: currentDate,
        timeCt: normalizeCtTime(timeMatch?.[1] ?? ""),
        releaseId: Number(releaseMatch[1]),
        title: stripTags(releaseMatch[2]),
      });
    }

    match = rowRegex.exec(html);
  }
}

export function parseFredCalendar(html: string): EconomicCalendarEvent[] {
  const events: EconomicCalendarEvent[] = [];

  parseCalendarRows(html, ({ date, timeCt, releaseId, title }) => {
    const meta = classifyRelease(title);
    if (!meta || !timeCt) return;

    events.push({
      id: `${releaseId}:${date}:${timeCt}`,
      releaseId,
      title,
      category: meta.category,
      importance: meta.importance,
      date,
      timeCt,
      releaseUrl: "",
      status: buildDataStatus({
        provider: "Limuria Intelligence",
        freshness: "schedule",
        delayLabel: "Scheduled release calendar",
      }),
    });
  });

  return events.sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    return parseMinutes(left.timeCt) - parseMinutes(right.timeCt);
  });
}

export function parseFredReleaseSchedule(html: string, releaseId: number): EconomicReleaseScheduleDate[] {
  const dates: EconomicReleaseScheduleDate[] = [];

  parseCalendarRows(html, ({ date, timeCt, releaseId: candidateReleaseId }) => {
    if (candidateReleaseId !== releaseId || !timeCt) return;
    dates.push({ date, timeCt });
  });

  return dates.sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    return parseMinutes(left.timeCt) - parseMinutes(right.timeCt);
  });
}

export function filterUpcomingReleaseDates(dates: EconomicReleaseScheduleDate[], now = new Date()) {
  const today = isoDate(now);

  return dates
    .filter((entry) => entry.date >= today)
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.date === entry.date && candidate.timeCt === entry.timeCt) === index)
    .sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      return parseMinutes(left.timeCt) - parseMinutes(right.timeCt);
    });
}

export function parseFredReleaseDetail(html: string, releaseId: number): Omit<EconomicEventDetail, "upcomingDates"> {
  const heading = stripTags(html.match(/<h1>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const titleTag = stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s*\|\s*FRED.*$/i, "");
  const title = heading || titleTag || `Release ${releaseId}`;
  const meta = classifyRelease(title) ?? { category: "activity" as EconomicEventCategory, importance: "medium" as EconomicEventImportance };

  const breadcrumbMatches = Array.from(html.matchAll(/<a[^>]+class="breadcrumb_link"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi));
  const source = breadcrumbMatches.at(-1);

  return {
    releaseId,
    title,
    category: meta.category,
    importance: meta.importance,
    sourceName: "Limuria Intelligence Research",
    sourceUrl: null,
    releaseCalendarUrl: "",
    releaseWebsiteUrl: null,
    tables: [],
    status: buildDataStatus({
      provider: "Limuria Intelligence",
      freshness: "schedule",
      delayLabel: "Scheduled release detail",
    }),
  };
}

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function getEconomicCalendar(now = new Date()) {
  const start = isoDate(now);
  const end = isoDate(addDays(now, CALENDAR_WINDOW_DAYS));
  const cacheKey = `${start}:${end}`;
  const cached = getCached(calendarCache, cacheKey);
  if (cached) return cached;

  const html = await fetchText(`${FRED_BASE_URL}/releases/calendar?vs=${start}&ve=${end}`);
  return setCached(calendarCache, cacheKey, parseFredCalendar(html), CALENDAR_TTL_MS);
}

export async function getEconomicEventDetail(releaseId: number, now = new Date()): Promise<EconomicEventDetail> {
  const cacheKey = String(releaseId);
  const cached = getCached(detailCache, cacheKey);
  if (cached) return cached;

  const year = now.getUTCFullYear();
  const releaseUrl = `${FRED_BASE_URL}/release?rid=${releaseId}`;
  const scheduleUrls = [
    `${FRED_BASE_URL}/releases/calendar?rid=${releaseId}&y=${year}`,
    `${FRED_BASE_URL}/releases/calendar?rid=${releaseId}&y=${year + 1}`,
  ];

  const [detailHtml, ...schedulePages] = await Promise.all([
    fetchText(releaseUrl),
    ...scheduleUrls.map((url) => fetchText(url)),
  ]);

  const detail = parseFredReleaseDetail(detailHtml, releaseId);
  const upcomingDates = filterUpcomingReleaseDates(
    schedulePages.flatMap((page) => parseFredReleaseSchedule(page, releaseId)),
    now,
  ).slice(0, 6);

  return setCached(detailCache, cacheKey, { ...detail, upcomingDates }, DETAIL_TTL_MS);
}
