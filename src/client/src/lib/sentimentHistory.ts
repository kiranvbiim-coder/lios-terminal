export interface SentimentObservation {
  at: number;
  score: number;
}

export interface SentimentHistorySummary {
  dayAgo: SentimentObservation | null;
  weekAgo: SentimentObservation | null;
  monthAgo: SentimentObservation | null;
  percentile: number | null;
  sevenDayChange: number | null;
}

const DAY = 24 * 60 * 60 * 1000;

function valid(observation: SentimentObservation) {
  return Number.isFinite(observation.at) && Number.isFinite(observation.score) && observation.score >= 0 && observation.score <= 100;
}

export function appendSentimentObservation(
  history: SentimentObservation[],
  observation: SentimentObservation,
  minIntervalMs = 5 * 60 * 1000,
  maxAgeMs = 90 * DAY,
): SentimentObservation[] {
  const clean = history.filter(valid).sort((a, b) => a.at - b.at);
  if (!valid(observation)) return clean;
  const cutoff = observation.at - maxAgeMs;
  const retained = clean.filter((item) => item.at >= cutoff && item.at <= observation.at);
  const last = retained[retained.length - 1];
  if (last && observation.at - last.at < minIntervalMs) {
    // Keep the sampling timestamp stable inside a sampling bucket. Updating the
    // score is useful when the source refreshes, but moving the timestamp on
    // every render would turn one observation into an endless stream of new
    // observations and would falsely imply more historical coverage.
    if (last.score === observation.score) return retained;
    return [...retained.slice(0, -1), { at: last.at, score: observation.score }];
  }
  return [...retained, observation];
}

export function nearestHistoricalObservation(
  history: SentimentObservation[],
  targetAt: number,
  toleranceMs: number,
): SentimentObservation | null {
  let nearest: SentimentObservation | null = null;
  let distance = Infinity;
  for (const observation of history) {
    if (!valid(observation) || observation.at > targetAt + toleranceMs) continue;
    const currentDistance = Math.abs(observation.at - targetAt);
    if (currentDistance <= toleranceMs && currentDistance < distance) {
      nearest = observation;
      distance = currentDistance;
    }
  }
  return nearest;
}

export function summarizeSentimentHistory(history: SentimentObservation[], current: SentimentObservation): SentimentHistorySummary {
  const clean = history.filter(valid).sort((a, b) => a.at - b.at);
  const dayAgo = nearestHistoricalObservation(clean, current.at - DAY, 8 * 60 * 60 * 1000);
  const weekAgo = nearestHistoricalObservation(clean, current.at - 7 * DAY, DAY);
  const monthAgo = nearestHistoricalObservation(clean, current.at - 30 * DAY, 3 * DAY);
  const percentile = clean.length >= 5
    ? (clean.filter((item) => item.score <= current.score).length / clean.length) * 100
    : null;
  return {
    dayAgo,
    weekAgo,
    monthAgo,
    percentile,
    sevenDayChange: weekAgo ? current.score - weekAgo.score : null,
  };
}
