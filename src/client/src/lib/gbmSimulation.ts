export interface GbmSimulationInput {
  initialPrice: number;
  annualDrift: number;
  annualVolatility: number;
  tradingDays: number;
  simulations: number;
  seed: number;
  stepsPerYear?: number;
  visiblePaths?: number;
}

export interface GbmStepSummary {
  day: number;
  p10: number;
  p50: number;
  p90: number;
  paths: number[];
}

export interface GbmSimulationResult {
  steps: GbmStepSummary[];
  terminalP10: number;
  terminalP50: number;
  terminalP90: number;
  probabilityPositivePct: number;
}

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomNormal(random: () => number) {
  let u = 0;
  let v = 0;
  while (u <= Number.EPSILON) u = random();
  while (v <= Number.EPSILON) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function quantile(sorted: number[], probability: number) {
  if (!sorted.length) return Number.NaN;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function runGbmSimulation(input: GbmSimulationInput): GbmSimulationResult {
  const { initialPrice, annualDrift, annualVolatility, tradingDays, simulations, seed } = input;
  const stepsPerYear = input.stepsPerYear ?? 252;
  const visiblePaths = Math.max(0, Math.min(input.visiblePaths ?? 12, simulations));
  if (!(initialPrice > 0) || !Number.isFinite(initialPrice)) throw new Error("initialPrice must be positive and finite");
  if (!Number.isFinite(annualDrift)) throw new Error("annualDrift must be finite");
  if (!(annualVolatility >= 0) || !Number.isFinite(annualVolatility)) throw new Error("annualVolatility must be non-negative and finite");
  if (!Number.isInteger(tradingDays) || tradingDays < 1) throw new Error("tradingDays must be a positive integer");
  if (!Number.isInteger(simulations) || simulations < 20) throw new Error("simulations must be an integer >= 20");
  if (!Number.isInteger(stepsPerYear) || stepsPerYear < 1) throw new Error("stepsPerYear must be a positive integer");

  const random = mulberry32(seed);
  const dt = 1 / stepsPerYear;
  const driftStep = (annualDrift - 0.5 * annualVolatility ** 2) * dt;
  const volatilityStep = annualVolatility * Math.sqrt(dt);
  const paths = Array.from({ length: simulations }, () => new Float64Array(tradingDays + 1));
  for (const path of paths) path[0] = initialPrice;

  if (annualVolatility === 0) {
    for (const path of paths) {
      for (let day = 1; day <= tradingDays; day += 1) {
        path[day] = initialPrice * Math.exp(driftStep * day);
      }
    }
  } else {
    for (let simulation = 0; simulation < simulations; simulation += 1) {
      for (let day = 1; day <= tradingDays; day += 1) {
        paths[simulation][day] = paths[simulation][day - 1] * Math.exp(driftStep + volatilityStep * randomNormal(random));
      }
    }
  }

  const steps: GbmStepSummary[] = [];
  for (let day = 0; day <= tradingDays; day += 1) {
    const values = paths.map((path) => path[day]).sort((a, b) => a - b);
    steps.push({
      day,
      p10: quantile(values, 0.1),
      p50: quantile(values, 0.5),
      p90: quantile(values, 0.9),
      paths: paths.slice(0, visiblePaths).map((path) => path[day]),
    });
  }

  const terminal = paths.map((path) => path[tradingDays]).sort((a, b) => a - b);
  return {
    steps,
    terminalP10: quantile(terminal, 0.1),
    terminalP50: quantile(terminal, 0.5),
    terminalP90: quantile(terminal, 0.9),
    probabilityPositivePct: terminal.filter((price) => price > initialPrice).length / simulations * 100,
  };
}

export function stableSimulationSeed(symbol: string, horizon: number, revision = 0) {
  let hash = 2166136261;
  const source = `${symbol}|${horizon}|${revision}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
