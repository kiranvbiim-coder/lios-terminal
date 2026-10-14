"""Advanced credit analytics: Merton structural model, migration matrices,
CreditMetrics-style portfolio simulation, stress PD and covenant headroom.
"""
from __future__ import annotations

from math import erf, exp, log, sqrt
from typing import Dict, List, Optional

import numpy as np
from pydantic import BaseModel, Field
from scipy import optimize


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + erf(x / sqrt(2.0)))


class MertonRequest(BaseModel):
    equityValue: float = Field(gt=0)
    equityVolPct: float = Field(gt=0)
    debtFaceValue: float = Field(gt=0)
    riskFreeRatePct: float
    maturityYears: float = Field(default=1.0, gt=0)


class MertonResponse(BaseModel):
    assetValue: float
    assetVolPct: float
    distanceToDefault: float
    riskNeutralDefaultProbabilityPct: float
    equityRepricingError: float
    volatilityRepricingErrorPct: float


def merton_structural(req: MertonRequest) -> MertonResponse:
    e, sigma_e, d, r, t = req.equityValue, req.equityVolPct / 100.0, req.debtFaceValue, req.riskFreeRatePct / 100.0, req.maturityYears

    def equations(x: np.ndarray) -> np.ndarray:
        v, sigma_v = x
        if v <= 0 or sigma_v <= 0:
            return np.array([1e6, 1e6])
        d1 = (log(v / d) + (r + 0.5 * sigma_v ** 2) * t) / (sigma_v * sqrt(t))
        d2 = d1 - sigma_v * sqrt(t)
        model_e = v * _norm_cdf(d1) - d * exp(-r * t) * _norm_cdf(d2)
        model_sigma_e = (v / max(model_e, 1e-12)) * _norm_cdf(d1) * sigma_v
        return np.array([(model_e - e) / max(e, 1.0), model_sigma_e - sigma_e])

    guess = np.array([e + d, max(0.05, sigma_e * e / (e + d))])
    res = optimize.least_squares(equations, guess, bounds=([1e-8, 1e-6], [1e15, 5.0]), xtol=1e-13, ftol=1e-13, gtol=1e-13)
    if not res.success:
        raise ValueError(f"Merton calibration failed: {res.message}")
    v, sigma_v = map(float, res.x)
    d1 = (log(v / d) + (r + 0.5 * sigma_v ** 2) * t) / (sigma_v * sqrt(t))
    d2 = d1 - sigma_v * sqrt(t)
    model_e = v * _norm_cdf(d1) - d * exp(-r * t) * _norm_cdf(d2)
    model_sigma_e = (v / max(model_e, 1e-12)) * _norm_cdf(d1) * sigma_v
    dd = (log(v / d) + (r - 0.5 * sigma_v ** 2) * t) / (sigma_v * sqrt(t))
    pd = _norm_cdf(-dd)
    return MertonResponse(assetValue=v, assetVolPct=sigma_v * 100.0, distanceToDefault=dd, riskNeutralDefaultProbabilityPct=pd * 100.0, equityRepricingError=abs(model_e - e), volatilityRepricingErrorPct=abs(model_sigma_e - sigma_e) * 100.0)


class MigrationMatrixRequest(BaseModel):
    ratings: List[str]
    transitionMatrix: List[List[float]]
    currentDistribution: List[float]
    periods: int = Field(default=1, ge=1, le=100)


class MigrationMatrixResponse(BaseModel):
    futureDistribution: Dict[str, float]
    cumulativeDefaultProbability: float
    matrixRowSumMaxError: float


def rating_migration(req: MigrationMatrixRequest) -> MigrationMatrixResponse:
    n = len(req.ratings)
    P = np.asarray(req.transitionMatrix, dtype=float)
    current = np.asarray(req.currentDistribution, dtype=float)
    if P.shape != (n, n) or current.shape != (n,):
        raise ValueError("Transition matrix and distribution dimensions must match ratings.")
    if np.any(P < 0) or np.any(current < 0):
        raise ValueError("Transition probabilities and current distribution must be non-negative.")
    row_error = float(np.max(np.abs(P.sum(axis=1) - 1.0)))
    if row_error > 1e-8:
        raise ValueError("Each transition-matrix row must sum to 1.")
    if abs(float(current.sum()) - 1.0) > 1e-8:
        raise ValueError("Current rating distribution must sum to 1.")
    future = current @ np.linalg.matrix_power(P, req.periods)
    default_idx = next((i for i, name in enumerate(req.ratings) if name.strip().lower() in {"d", "default"}), None)
    default_prob = float(future[default_idx]) if default_idx is not None else 0.0
    return MigrationMatrixResponse(futureDistribution={r: float(v) for r, v in zip(req.ratings, future)}, cumulativeDefaultProbability=default_prob, matrixRowSumMaxError=row_error)


class CreditExposure(BaseModel):
    name: str
    ead: float = Field(ge=0)
    pdPct: float = Field(ge=0, le=100)
    lgdPct: float = Field(ge=0, le=100)
    sector: Optional[str] = None


class CreditMetricsRequest(BaseModel):
    exposures: List[CreditExposure]
    assetCorrelation: float = Field(default=0.2, ge=0, lt=1)
    confidencePct: float = Field(default=99.0, ge=90, lt=100)
    nSimulations: int = Field(default=50000, ge=5000, le=500000)
    seed: int = 42


class CreditMetricsResponse(BaseModel):
    expectedLoss: float
    unexpectedLossStd: float
    creditVar: float
    economicCapital: float
    tailExpectedShortfall: float
    seed: int


def creditmetrics_portfolio(req: CreditMetricsRequest) -> CreditMetricsResponse:
    if not req.exposures:
        raise ValueError("At least one credit exposure is required.")
    pd = np.array([x.pdPct / 100.0 for x in req.exposures])
    lgd = np.array([x.lgdPct / 100.0 for x in req.exposures])
    ead = np.array([x.ead for x in req.exposures])
    thresholds = np.array([optimize.brentq(lambda z, p=p: _norm_cdf(z) - p, -10, 10) if p > 0 else -10 for p in pd])
    rng = np.random.default_rng(req.seed)
    rho = req.assetCorrelation
    systemic = rng.standard_normal(req.nSimulations)
    losses = np.zeros(req.nSimulations, dtype=float)
    for i in range(len(req.exposures)):
        idio = rng.standard_normal(req.nSimulations)
        latent = sqrt(rho) * systemic + sqrt(1 - rho) * idio
        defaults = latent < thresholds[i]
        losses += defaults * ead[i] * lgd[i]
    expected = float(losses.mean())
    std = float(losses.std(ddof=1))
    q = float(np.quantile(losses, req.confidencePct / 100.0))
    tail = losses[losses >= q]
    es = float(tail.mean()) if len(tail) else q
    return CreditMetricsResponse(expectedLoss=expected, unexpectedLossStd=std, creditVar=q, economicCapital=max(0.0, q - expected), tailExpectedShortfall=es, seed=req.seed)


class StressPdRequest(BaseModel):
    basePdPct: List[float]
    macroShock: float
    beta: List[float]


class StressPdResponse(BaseModel):
    stressedPdPct: List[float]


def stress_pd(req: StressPdRequest) -> StressPdResponse:
    base = np.asarray(req.basePdPct, dtype=float) / 100.0
    beta = np.asarray(req.beta, dtype=float)
    if base.shape != beta.shape or np.any(base <= 0) or np.any(base >= 1):
        raise ValueError("Base PDs must be strictly between 0 and 100 and match beta dimensions.")
    logits = np.log(base / (1 - base)) + beta * req.macroShock
    stressed = 1 / (1 + np.exp(-logits))
    return StressPdResponse(stressedPdPct=list(map(float, stressed * 100.0)))


class CovenantRequest(BaseModel):
    ebitda: float
    netDebt: float
    interestExpense: float
    cashFlowFromOperations: float
    debtService: float
    maxNetLeverage: Optional[float] = None
    minInterestCoverage: Optional[float] = None
    minDebtServiceCoverage: Optional[float] = None


class CovenantResponse(BaseModel):
    netLeverage: float
    interestCoverage: float
    debtServiceCoverage: float
    headroom: Dict[str, float]
    breached: List[str]


def covenant_headroom(req: CovenantRequest) -> CovenantResponse:
    if req.ebitda == 0 or req.interestExpense == 0 or req.debtService == 0:
        raise ValueError("EBITDA, interest expense and debt service must be non-zero for covenant ratios.")
    leverage = req.netDebt / req.ebitda
    interest = req.ebitda / req.interestExpense
    dscr = req.cashFlowFromOperations / req.debtService
    headroom: Dict[str, float] = {}
    breached: List[str] = []
    if req.maxNetLeverage is not None:
        headroom["netLeverage"] = req.maxNetLeverage - leverage
        if headroom["netLeverage"] < 0: breached.append("netLeverage")
    if req.minInterestCoverage is not None:
        headroom["interestCoverage"] = interest - req.minInterestCoverage
        if headroom["interestCoverage"] < 0: breached.append("interestCoverage")
    if req.minDebtServiceCoverage is not None:
        headroom["debtServiceCoverage"] = dscr - req.minDebtServiceCoverage
        if headroom["debtServiceCoverage"] < 0: breached.append("debtServiceCoverage")
    return CovenantResponse(netLeverage=leverage, interestCoverage=interest, debtServiceCoverage=dscr, headroom=headroom, breached=breached)
