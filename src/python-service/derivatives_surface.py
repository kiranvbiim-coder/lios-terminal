"""Derivatives surface and portfolio analytics beyond single-option pricing."""
from __future__ import annotations

from math import exp
from typing import Dict, List, Literal

import numpy as np
from pydantic import BaseModel, Field

from advanced_derivatives import BlackScholesRequest, black_scholes_greeks


class LocalVolRequest(BaseModel):
    spot: float = Field(gt=0)
    ratePct: float = 0.0
    dividendYieldPct: float = 0.0
    maturitiesYears: List[float]
    strikes: List[float]
    impliedVolatilityPct: List[List[float]]


class LocalVolNode(BaseModel):
    maturityYears: float
    strike: float
    localVolatilityPct: float
    densityCurvature: float


class LocalVolResponse(BaseModel):
    nodes: List[LocalVolNode]
    rejectedNodes: int


def dupire_local_vol(req: LocalVolRequest) -> LocalVolResponse:
    times = np.asarray(req.maturitiesYears, dtype=float)
    strikes = np.asarray(req.strikes, dtype=float)
    vols = np.asarray(req.impliedVolatilityPct, dtype=float) / 100.0
    if len(times) < 3 or len(strikes) < 3 or vols.shape != (len(times), len(strikes)):
        raise ValueError("Dupire local volatility requires at least a 3x3 maturity/strike grid.")
    if np.any(times <= 0) or np.any(np.diff(times) <= 0) or np.any(strikes <= 0) or np.any(np.diff(strikes) <= 0) or np.any(vols <= 0):
        raise ValueError("Maturities/strikes must be increasing and implied volatilities positive.")
    r, q = req.ratePct / 100.0, req.dividendYieldPct / 100.0
    calls = np.empty_like(vols)
    for i, t in enumerate(times):
        for j, k in enumerate(strikes):
            calls[i, j] = black_scholes_greeks(BlackScholesRequest(
                spot=req.spot, strike=float(k), maturityYears=float(t), ratePct=req.ratePct,
                dividendYieldPct=req.dividendYieldPct, volatilityPct=float(vols[i, j] * 100), optionType="call",
            )).price
    nodes: List[LocalVolNode] = []
    rejected = 0
    for i in range(1, len(times) - 1):
        dt = times[i + 1] - times[i - 1]
        for j in range(1, len(strikes) - 1):
            dk_l = strikes[j] - strikes[j - 1]
            dk_r = strikes[j + 1] - strikes[j]
            if abs(dk_l - dk_r) > 1e-8:
                dC_dK = (calls[i, j + 1] - calls[i, j - 1]) / (dk_l + dk_r)
                left_slope = (calls[i, j] - calls[i, j - 1]) / dk_l
                right_slope = (calls[i, j + 1] - calls[i, j]) / dk_r
                d2C_dK2 = 2 * (right_slope - left_slope) / (dk_l + dk_r)
            else:
                h = dk_l
                dC_dK = (calls[i, j + 1] - calls[i, j - 1]) / (2 * h)
                d2C_dK2 = (calls[i, j + 1] - 2 * calls[i, j] + calls[i, j - 1]) / (h * h)
            dC_dT = (calls[i + 1, j] - calls[i - 1, j]) / dt
            K = strikes[j]
            numerator = dC_dT + (r - q) * K * dC_dK + q * calls[i, j]
            denominator = 0.5 * K * K * d2C_dK2
            if denominator <= 1e-12 or numerator <= 0:
                rejected += 1
                continue
            local_var = numerator / denominator
            if not np.isfinite(local_var) or local_var <= 0:
                rejected += 1
                continue
            nodes.append(LocalVolNode(maturityYears=float(times[i]), strike=float(K), localVolatilityPct=float(np.sqrt(local_var) * 100), densityCurvature=float(d2C_dK2)))
    if not nodes:
        raise ValueError("No positive-arbitrage-consistent local-vol nodes could be derived from the surface.")
    return LocalVolResponse(nodes=nodes, rejectedNodes=rejected)


class OptionPosition(BaseModel):
    name: str
    quantity: float
    contractMultiplier: float = Field(default=1.0, gt=0)
    spot: float = Field(gt=0)
    strike: float = Field(gt=0)
    maturityYears: float = Field(gt=0)
    ratePct: float
    dividendYieldPct: float = 0.0
    volatilityPct: float = Field(gt=0)
    optionType: Literal["call", "put"]


class PortfolioGreeksRequest(BaseModel):
    positions: List[OptionPosition]


class PortfolioGreeksResponse(BaseModel):
    marketValue: float
    delta: float
    gamma: float
    vegaPerVolPoint: float
    thetaPerDay: float
    rhoPerRatePoint: float
    vanna: float
    vomma: float
    charmPerDay: float
    byPosition: Dict[str, Dict[str, float]]


def portfolio_greeks(req: PortfolioGreeksRequest) -> PortfolioGreeksResponse:
    positions = req.positions
    if not positions:
        raise ValueError("At least one option position is required.")
    totals = {k: 0.0 for k in ["marketValue", "delta", "gamma", "vegaPerVolPoint", "thetaPerDay", "rhoPerRatePoint", "vanna", "vomma", "charmPerDay"]}
    by_position: Dict[str, Dict[str, float]] = {}
    for p in positions:
        g = black_scholes_greeks(BlackScholesRequest(
            spot=p.spot, strike=p.strike, maturityYears=p.maturityYears, ratePct=p.ratePct,
            dividendYieldPct=p.dividendYieldPct, volatilityPct=p.volatilityPct, optionType=p.optionType,
        ))
        scale = p.quantity * p.contractMultiplier
        vals = {
            "marketValue": g.price * scale, "delta": g.delta * scale, "gamma": g.gamma * scale,
            "vegaPerVolPoint": g.vegaPerVolPoint * scale, "thetaPerDay": g.thetaPerDay * scale,
            "rhoPerRatePoint": g.rhoPerRatePoint * scale, "vanna": g.vanna * scale,
            "vomma": g.vomma * scale, "charmPerDay": g.charmPerDay * scale,
        }
        if p.name in by_position:
            raise ValueError(f"Duplicate option position name: {p.name}")
        by_position[p.name] = vals
        for key, value in vals.items():
            totals[key] += value
    return PortfolioGreeksResponse(**totals, byPosition=by_position)


class FuturesBasisRequest(BaseModel):
    spotPrice: float = Field(gt=0)
    futuresPrice: float = Field(gt=0)
    daysToMaturity: int = Field(gt=0, le=3650)
    financingRatePct: float
    incomeYieldPct: float = 0.0
    storageCostPct: float = 0.0


class FuturesBasisResponse(BaseModel):
    observedBasis: float
    fairFuturesPrice: float
    fairBasis: float
    basisMispricing: float
    impliedNetCarryPct: float
    annualizedBasisPct: float


def futures_basis(req: FuturesBasisRequest) -> FuturesBasisResponse:
    t = req.daysToMaturity / 365.0
    carry = (req.financingRatePct + req.storageCostPct - req.incomeYieldPct) / 100.0
    fair = req.spotPrice * exp(carry * t)
    observed_basis = req.futuresPrice - req.spotPrice
    implied_carry = np.log(req.futuresPrice / req.spotPrice) / t * 100.0
    annualized_basis = observed_basis / req.spotPrice / t * 100.0
    return FuturesBasisResponse(observedBasis=observed_basis, fairFuturesPrice=fair, fairBasis=fair - req.spotPrice, basisMispricing=req.futuresPrice - fair, impliedNetCarryPct=float(implied_carry), annualizedBasisPct=float(annualized_basis))


class StrategyLeg(BaseModel):
    optionType: Literal["call", "put"]
    strike: float = Field(gt=0)
    quantity: float
    premium: float = Field(ge=0)
    contractMultiplier: float = Field(default=1.0, gt=0)


class OptionStrategyRequest(BaseModel):
    legs: List[StrategyLeg]
    underlyingMin: float = Field(gt=0)
    underlyingMax: float = Field(gt=0)
    gridPoints: int = Field(default=401, ge=51, le=5001)


class OptionStrategyResponse(BaseModel):
    underlyingGrid: List[float]
    pnl: List[float]
    maxProfitOnGrid: float
    maxLossOnGrid: float
    breakEvenApprox: List[float]
    netPremiumCashFlow: float


def option_strategy_payoff(req: OptionStrategyRequest) -> OptionStrategyResponse:
    if not req.legs or req.underlyingMax <= req.underlyingMin:
        raise ValueError("Strategy requires legs and underlyingMax > underlyingMin.")
    s = np.linspace(req.underlyingMin, req.underlyingMax, req.gridPoints)
    pnl = np.zeros_like(s)
    net_premium = 0.0
    for leg in req.legs:
        intrinsic = np.maximum(s - leg.strike, 0.0) if leg.optionType == "call" else np.maximum(leg.strike - s, 0.0)
        scale = leg.quantity * leg.contractMultiplier
        pnl += scale * (intrinsic - leg.premium)
        net_premium += -scale * leg.premium
    roots = []
    signs = np.sign(pnl)
    for i in range(len(s) - 1):
        if pnl[i] == 0:
            roots.append(float(s[i]))
        elif signs[i] != signs[i + 1]:
            w = abs(pnl[i]) / (abs(pnl[i]) + abs(pnl[i + 1]))
            roots.append(float(s[i] * (1 - w) + s[i + 1] * w))
    return OptionStrategyResponse(underlyingGrid=list(map(float, s)), pnl=list(map(float, pnl)), maxProfitOnGrid=float(pnl.max()), maxLossOnGrid=float(pnl.min()), breakEvenApprox=roots, netPremiumCashFlow=float(net_premium))
