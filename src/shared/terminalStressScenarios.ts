export const TERMINAL_STRESS_SCENARIOS: { id: string; label: string; color: string; factors: Record<string,number>; desc: string }[] = [
  {
    id: "gfc2008", label: "2008 GFC",         color: "hsl(0,80%,55%)",
    factors: { equity: -0.55, bonds: 0.18, gold: 0.05, oil: -0.55, emerging: -0.65, tech: -0.52, financial: -0.78, real_estate: -0.62 },
    desc: "Global Financial Crisis — credit collapse, bank failures",
  },
  {
    id: "covid2020", label: "COVID Crash",     color: "hsl(270,60%,60%)",
    factors: { equity: -0.34, bonds: 0.08, gold: 0.05, oil: -0.65, emerging: -0.38, tech: -0.25, financial: -0.42, real_estate: -0.30 },
    desc: "Mar 2020 COVID crash — fastest bear market ever",
  },
  {
    id: "dotcom2000", label: "Dot-Com Bust",   color: "hsl(20,90%,55%)",
    factors: { equity: -0.48, bonds: 0.12, gold: 0.10, oil: -0.30, emerging: -0.35, tech: -0.78, financial: -0.25, real_estate: 0.05 },
    desc: "2000-2002 dot-com collapse — technology wipeout",
  },
  {
    id: "rateshock", label: "Rate Shock",      color: "hsl(38,95%,55%)",
    factors: { equity: -0.20, bonds: -0.25, gold: -0.05, oil: 0.05, emerging: -0.25, tech: -0.30, financial: 0.05, real_estate: -0.28 },
    desc: "2022-style aggressive rate hike cycle",
  },
  {
    id: "stagflation", label: "Stagflation",   color: "hsl(200,80%,55%)",
    factors: { equity: -0.30, bonds: -0.15, gold: 0.35, oil: 0.60, emerging: -0.20, tech: -0.35, financial: -0.15, real_estate: -0.10 },
    desc: "1970s-style stagflation — high inflation + recession",
  },
  {
    id: "flash_crash", label: "Flash Crash",   color: "hsl(60,80%,50%)",
    factors: { equity: -0.10, bonds: 0.03, gold: 0.02, oil: -0.08, emerging: -0.12, tech: -0.12, financial: -0.10, real_estate: -0.05 },
    desc: "Liquidity-driven sharp drawdown (like Aug 2015)",
  },
];