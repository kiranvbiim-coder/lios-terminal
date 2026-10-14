"""Advanced derivatives analytics: implied vol, higher Greeks, surface checks,
exotic Monte Carlo and rates derivatives. Seeded stochastic routines are reproducible.
"""
from __future__ import annotations

from math import erf, exp, log, pi, sqrt
from typing import Dict, List, Literal, Optional

import numpy as np
from pydantic import BaseModel, Field
from scipy import optimize


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + erf(x / sqrt(2.0)))


def _norm_pdf(x: float) -> float:
    return exp(-0.5 * x * x) / sqrt(2.0 * pi)


def _bs_price(spot: float, strike: float, maturity: float, rate: float, div: float, vol: float, option: str) -> float:
    if maturity <= 0 or vol <= 0 or spot <= 0 or strike <= 0:
        raise ValueError("spot, strike, maturity and volatility must be positive.")
    d1 = (log(spot / strike) + (rate - div + 0.5 * vol * vol) * maturity) / (vol * sqrt(maturity))
    d2 = d1 - vol * sqrt(maturity)
    if option == "call":
        return spot * exp(-div * maturity) * _norm_cdf(d1) - strike * exp(-rate * maturity) * _norm_cdf(d2)
    return strike * exp(-rate * maturity) * _norm_cdf(-d2) - spot * exp(-div * maturity) * _norm_cdf(-d1)


class BlackScholesRequest(BaseModel):
    spot: float = Field(gt=0)
    strike: float = Field(gt=0)
    maturityYears: float = Field(gt=0)
    ratePct: float
    dividendYieldPct: float = 0.0
    volatilityPct: float = Field(gt=0)
    optionType: Literal["call", "put"]


class GreeksResponse(BaseModel):
    price: float
    delta: float
    gamma: float
    vegaPerVolPoint: float
    thetaPerDay: float
    rhoPerRatePoint: float
    vanna: float
    vomma: float
    charmPerDay: float


def black_scholes_greeks(req: BlackScholesRequest) -> GreeksResponse:
    s, k, t = req.spot, req.strike, req.maturityYears
    r, q, v = req.ratePct / 100.0, req.dividendYieldPct / 100.0, req.volatilityPct / 100.0
    sqrt_t = sqrt(t)
    d1 = (log(s / k) + (r - q + 0.5 * v * v) * t) / (v * sqrt_t)
    d2 = d1 - v * sqrt_t
    pdf = _norm_pdf(d1)
    disc_q, disc_r = exp(-q * t), exp(-r * t)
    price = _bs_price(s, k, t, r, q, v, req.optionType)
    if req.optionType == "call":
        delta = disc_q * _norm_cdf(d1)
        theta = (-s * disc_q * pdf * v / (2 * sqrt_t) - r * k * disc_r * _norm_cdf(d2) + q * s * disc_q * _norm_cdf(d1)) / 365.0
        rho = k * t * disc_r * _norm_cdf(d2) / 100.0
    else:
        delta = disc_q * (_norm_cdf(d1) - 1.0)
        theta = (-s * disc_q * pdf * v / (2 * sqrt_t) + r * k * disc_r * _norm_cdf(-d2) - q * s * disc_q * _norm_cdf(-d1)) / 365.0
        rho = -k * t * disc_r * _norm_cdf(-d2) / 100.0
    gamma = disc_q * pdf / (s * v * sqrt_t)
    vega = s * disc_q * pdf * sqrt_t / 100.0
    vanna = -disc_q * pdf * d2 / v
    vomma = s * disc_q * pdf * sqrt_t * d1 * d2 / v / 10000.0
    charm = (-disc_q * (pdf * (2 * (r - q) * t - d2 * v * sqrt_t) / (2 * t * v * sqrt_t) + q * (_norm_cdf(d1) if req.optionType == "call" else _norm_cdf(d1) - 1.0))) / 365.0
    return GreeksResponse(price=price, delta=delta, gamma=gamma, vegaPerVolPoint=vega, thetaPerDay=theta, rhoPerRatePoint=rho, vanna=vanna, vomma=vomma, charmPerDay=charm)


class ImpliedVolRequest(BaseModel):
    spot: float = Field(gt=0)
    strike: float = Field(gt=0)
    maturityYears: float = Field(gt=0)
    ratePct: float
    dividendYieldPct: float = 0.0
    optionType: Literal["call", "put"]
    marketPrice: float = Field(gt=0)


class ImpliedVolResponse(BaseModel):
    impliedVolatilityPct: float
    repricedValue: float
    absolutePricingError: float


def implied_volatility(req: ImpliedVolRequest) -> ImpliedVolResponse:
    r, q = req.ratePct / 100.0, req.dividendYieldPct / 100.0
    intrinsic_floor = max(0.0, req.spot * exp(-q * req.maturityYears) - req.strike * exp(-r * req.maturityYears)) if req.optionType == "call" else max(0.0, req.strike * exp(-r * req.maturityYears) - req.spot * exp(-q * req.maturityYears))
    upper = req.spot * exp(-q * req.maturityYears) if req.optionType == "call" else req.strike * exp(-r * req.maturityYears)
    if req.marketPrice < intrinsic_floor - 1e-10 or req.marketPrice > upper + 1e-10:
        raise ValueError("Market price violates European no-arbitrage bounds.")

    def f(vol: float) -> float:
        return _bs_price(req.spot, req.strike, req.maturityYears, r, q, vol, req.optionType) - req.marketPrice

    vol = float(optimize.brentq(f, 1e-6, 10.0, xtol=1e-13))
    value = _bs_price(req.spot, req.strike, req.maturityYears, r, q, vol, req.optionType)
    return ImpliedVolResponse(impliedVolatilityPct=vol * 100.0, repricedValue=value, absolutePricingError=abs(value - req.marketPrice))


class SurfaceQuote(BaseModel):
    maturityYears: float = Field(gt=0)
    strike: float = Field(gt=0)
    callPrice: float = Field(ge=0)


class VolSurfaceCheckRequest(BaseModel):
    spot: float = Field(gt=0)
    ratePct: float = 0.0
    dividendYieldPct: float = 0.0
    quotes: List[SurfaceQuote]


class VolSurfaceCheckResponse(BaseModel):
    arbitrageFree: bool
    violations: List[str]


def check_vol_surface_arbitrage(req: VolSurfaceCheckRequest) -> VolSurfaceCheckResponse:
    if len(req.quotes) < 3:
        raise ValueError("At least three surface quotes are required.")
    violations: List[str] = []
    grouped: Dict[float, List[SurfaceQuote]] = {}
    for q in req.quotes:
        grouped.setdefault(q.maturityYears, []).append(q)
    for maturity, quotes in grouped.items():
        ordered = sorted(quotes, key=lambda q: q.strike)
        prices = np.array([q.callPrice for q in ordered], dtype=float)
        strikes = np.array([q.strike for q in ordered], dtype=float)
        if np.any(np.diff(prices) > 1e-8):
            violations.append(f"call_monotonicity:{maturity:g}Y")
        if len(prices) >= 3:
            slopes = np.diff(prices) / np.diff(strikes)
            if np.any(np.diff(slopes) < -1e-8):
                violations.append(f"call_convexity:{maturity:g}Y")
    by_strike: Dict[float, List[SurfaceQuote]] = {}
    for q in req.quotes:
        by_strike.setdefault(q.strike, []).append(q)
    for strike, quotes in by_strike.items():
        ordered = sorted(quotes, key=lambda q: q.maturityYears)
        if any(ordered[i + 1].callPrice + 1e-8 < ordered[i].callPrice for i in range(len(ordered) - 1)):
            violations.append(f"calendar_spread:K={strike:g}")
    return VolSurfaceCheckResponse(arbitrageFree=not violations, violations=violations)


class ExoticMonteCarloRequest(BaseModel):
    spot: float = Field(gt=0)
    strike: float = Field(gt=0)
    maturityYears: float = Field(gt=0, le=100)
    ratePct: float
    dividendYieldPct: float = 0.0
    volatilityPct: float = Field(gt=0, le=1000)
    optionType: Literal["call", "put"] = "call"
    payoffType: Literal["asian_arithmetic", "digital", "up_and_out", "down_and_out"]
    barrier: Optional[float] = Field(default=None, gt=0)
    nPaths: int = Field(default=50000, ge=2000, le=500000)
    nSteps: int = Field(default=252, ge=2, le=2000)
    seed: int = 42


class ExoticMonteCarloResponse(BaseModel):
    price: float
    standardError: float
    confidence95Low: float
    confidence95High: float
    seed: int


def exotic_monte_carlo(req: ExoticMonteCarloRequest) -> ExoticMonteCarloResponse:
    if req.payoffType in {"up_and_out", "down_and_out"} and req.barrier is None:
        raise ValueError("Barrier is required for barrier options.")
    rng = np.random.default_rng(req.seed)
    dt = req.maturityYears / req.nSteps
    r, q, v = req.ratePct / 100.0, req.dividendYieldPct / 100.0, req.volatilityPct / 100.0
    drift = (r - q - 0.5 * v * v) * dt
    diffusion = v * sqrt(dt)
    discount = exp(-r * req.maturityYears)

    # Keep the temporary path matrix bounded to roughly 2M doubles (~16 MB).
    # The same RNG is consumed sequentially, so a fixed seed/request remains reproducible.
    max_chunk_elements = 2_000_000
    chunk_paths = max(1, min(req.nPaths, max_chunk_elements // req.nSteps))
    discounted_chunks: List[np.ndarray] = []
    remaining = req.nPaths
    while remaining > 0:
        count = min(chunk_paths, remaining)
        paths = rng.standard_normal((count, req.nSteps))
        paths *= diffusion
        paths += drift
        np.cumsum(paths, axis=1, out=paths)
        np.exp(paths, out=paths)
        paths *= req.spot
        terminal = paths[:, -1]
        vanilla = np.maximum(terminal - req.strike, 0.0) if req.optionType == "call" else np.maximum(req.strike - terminal, 0.0)
        if req.payoffType == "asian_arithmetic":
            avg = paths.mean(axis=1)
            payoff = np.maximum(avg - req.strike, 0.0) if req.optionType == "call" else np.maximum(req.strike - avg, 0.0)
        elif req.payoffType == "digital":
            payoff = (terminal > req.strike).astype(float) if req.optionType == "call" else (terminal < req.strike).astype(float)
        elif req.payoffType == "up_and_out":
            payoff = vanilla * (paths.max(axis=1) < float(req.barrier))
        else:
            payoff = vanilla * (paths.min(axis=1) > float(req.barrier))
        discounted_chunks.append(discount * payoff)
        remaining -= count

    discounted = np.concatenate(discounted_chunks)
    if len(discounted) != req.nPaths or not np.all(np.isfinite(discounted)):
        raise ValueError("Monte Carlo produced a non-finite payoff distribution.")
    price = float(discounted.mean())
    se = float(discounted.std(ddof=1) / sqrt(req.nPaths))
    return ExoticMonteCarloResponse(price=price, standardError=se, confidence95Low=price - 1.96 * se, confidence95High=price + 1.96 * se, seed=req.seed)


class SwapRequest(BaseModel):
    notional: float = Field(gt=0)
    fixedRatePct: float
    maturityYears: float = Field(gt=0)
    paymentsPerYear: int = Field(default=2, ge=1, le=12)
    discountRatePct: float
    forwardRatePct: float


class SwapResponse(BaseModel):
    fixedLegPv: float
    floatingLegPv: float
    payerSwapPv: float
    parSwapRatePct: float
    dv01: float


def interest_rate_swap(req: SwapRequest) -> SwapResponse:
    n = int(round(req.maturityYears * req.paymentsPerYear))
    if n <= 0:
        raise ValueError("Swap must contain at least one payment.")
    dt = 1.0 / req.paymentsPerYear
    r = req.discountRatePct / 100.0
    dfs = np.array([exp(-r * dt * (i + 1)) for i in range(n)], dtype=float)
    annuity = float(dt * dfs.sum())
    fixed = req.notional * req.fixedRatePct / 100.0 * annuity
    floating = req.notional * req.forwardRatePct / 100.0 * annuity
    par = req.forwardRatePct
    dv01 = req.notional * annuity * 1e-4
    return SwapResponse(fixedLegPv=fixed, floatingLegPv=floating, payerSwapPv=floating - fixed, parSwapRatePct=par, dv01=dv01)


class SwaptionRequest(BaseModel):
    notional: float = Field(gt=0)
    forwardSwapRatePct: float = Field(gt=0)
    strikePct: float = Field(gt=0)
    volatilityPct: float = Field(gt=0)
    optionExpiryYears: float = Field(gt=0)
    swapAnnuity: float = Field(gt=0)
    payer: bool = True


class SwaptionResponse(BaseModel):
    price: float


def black_swaption(req: SwaptionRequest) -> SwaptionResponse:
    f, k, v, t = req.forwardSwapRatePct / 100.0, req.strikePct / 100.0, req.volatilityPct / 100.0, req.optionExpiryYears
    d1 = (log(f / k) + 0.5 * v * v * t) / (v * sqrt(t))
    d2 = d1 - v * sqrt(t)
    unit = f * _norm_cdf(d1) - k * _norm_cdf(d2) if req.payer else k * _norm_cdf(-d2) - f * _norm_cdf(-d1)
    return SwaptionResponse(price=req.notional * req.swapAnnuity * unit)
