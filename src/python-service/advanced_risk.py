"""Institutional portfolio tail-risk and stress analytics for LiOS."""
from __future__ import annotations
from typing import Dict, List, Optional
import math
import numpy as np
from pydantic import BaseModel, Field
from scipy import stats


class TailRiskRequest(BaseModel):
    assets: List[str]
    returnsMatrixPct: List[List[float]]
    weights: List[float]
    portfolioValue: float = Field(default=1.0, gt=0.0, allow_inf_nan=False)
    confidencePct: float = Field(default=99.0, ge=90.0, le=99.9)
    ewmaLambda: float = Field(default=0.94, gt=0.0, lt=1.0)
    evtThresholdPct: float = Field(default=95.0, ge=90.0, le=99.0)
    monteCarloSims: int = Field(default=50000, ge=2000, le=500000)
    studentTDegreesFreedom: float = Field(default=6.0, gt=2.0, le=100.0)
    seed: int = 0


class TailRiskResponse(BaseModel):
    historicalVaR: float
    historicalES: float
    gaussianVaR: float
    gaussianES: float
    cornishFisherVaR: float
    evtVaR: Optional[float]
    evtES: Optional[float]
    filteredHistoricalVaR: float
    filteredHistoricalES: float
    studentTMonteCarloVaR: float
    studentTMonteCarloES: float
    componentGaussianVaR: Dict[str, float]
    marginalGaussianVaR: Dict[str, float]
    drawdownAtRiskPct: float
    maxDrawdownPct: float
    seed: int


def _inputs(req: TailRiskRequest):
    assets = list(req.assets); R = np.asarray(req.returnsMatrixPct, float) / 100; w = np.asarray(req.weights, float)
    if len(assets) < 1 or len(set(assets)) != len(assets):
        raise ValueError("assets must be unique and non-empty.")
    if R.ndim != 2 or R.shape[1] != len(assets) or R.shape[0] < 30 or w.shape != (len(assets),):
        raise ValueError("Return matrix/weights dimensions are invalid; at least 30 observations required.")
    if not np.all(np.isfinite(R)) or not np.all(np.isfinite(w)):
        raise ValueError("Returns and weights must be finite.")
    if abs(float(w.sum()) - 1) > 1e-6:
        raise ValueError("weights must sum to 1.")
    return assets, R, w


def _var_es(losses, alpha):
    var = float(np.quantile(losses, alpha, method="higher")); tail = losses[losses >= var]
    return var, float(np.mean(tail)) if len(tail) else var


def tail_risk_report(req: TailRiskRequest) -> TailRiskResponse:
    assets, R, w = _inputs(req); alpha = req.confidencePct / 100; V = req.portfolioValue
    pr = R @ w; losses = -pr * V
    hvar, hes = _var_es(losses, alpha)
    mu = float(np.mean(pr)); sigma = float(np.std(pr, ddof=1)); z = stats.norm.ppf(alpha)
    gvar = float((-mu + z * sigma) * V); ges = float((-mu + sigma * stats.norm.pdf(z) / (1 - alpha)) * V)
    skew = float(stats.skew(pr, bias=False)); kurt = float(stats.kurtosis(pr, fisher=True, bias=False))
    zcf = z + (z*z - 1)*skew/6 + (z**3 - 3*z)*kurt/24 - (2*z**3 - 5*z)*skew*skew/36
    cfvar = float((-mu + zcf * sigma) * V)
    threshold = float(np.percentile(losses, req.evtThresholdPct)); excess = losses[losses > threshold] - threshold
    evt_var = evt_es = None
    if len(excess) >= 20 and np.all(np.isfinite(excess)):
        try:
            shape, _loc, scale = stats.genpareto.fit(excess, floc=0)
            p_u = len(excess) / len(losses); tail_prob = 1 - alpha
            if scale > 0 and p_u > tail_prob:
                q = threshold + (scale / shape) * ((p_u / tail_prob) ** shape - 1) if abs(shape) > 1e-8 else threshold + scale * math.log(p_u / tail_prob)
                evt_var = float(q)
                if shape < 1:
                    evt_es = float((q + scale - shape * threshold) / (1 - shape))
        except Exception:
            pass
    lam = req.ewmaLambda
    variance = np.empty(len(pr)); variance[0] = np.var(pr, ddof=1)
    for i in range(1, len(pr)):
        variance[i] = lam * variance[i-1] + (1-lam) * pr[i-1]**2
    vols = np.sqrt(np.maximum(variance, 1e-18)); standardized = pr / vols
    fhs_returns = standardized * vols[-1]; fhvar, fhes = _var_es(-fhs_returns * V, alpha)
    cov = np.cov(R, rowvar=False)
    if np.ndim(cov) == 0:
        cov = np.array([[float(cov)]])
    eig = np.linalg.eigvalsh(cov)
    if float(eig.min()) < -1e-10:
        raise ValueError("Empirical covariance is not positive semidefinite.")
    rng = np.random.default_rng(req.seed); df = req.studentTDegreesFreedom; mean = np.mean(R, axis=0)
    zsim = rng.multivariate_normal(mean, cov * (df - 2) / df, size=req.monteCarloSims)
    chi = rng.chisquare(df, size=req.monteCarloSims)
    sims = mean + (zsim - mean) * np.sqrt(df / chi)[:, None]
    mcvar, mces = _var_es(-(sims @ w) * V, alpha)
    port_var = float(w @ cov @ w); port_sd = math.sqrt(max(port_var, 1e-18)); marginal_sd = (cov @ w) / port_sd
    marginal_var = z * marginal_sd * V; component = w * marginal_var
    wealth = np.cumprod(1 + pr); peaks = np.maximum.accumulate(wealth); dd = (wealth / peaks - 1) * 100
    dar = float(-np.percentile(dd, 100 * (1 - alpha))) if len(dd) else 0; mdd = float(-np.min(dd)) if len(dd) else 0
    return TailRiskResponse(historicalVaR=hvar, historicalES=hes, gaussianVaR=gvar, gaussianES=ges,
                            cornishFisherVaR=cfvar, evtVaR=evt_var, evtES=evt_es, filteredHistoricalVaR=fhvar,
                            filteredHistoricalES=fhes, studentTMonteCarloVaR=mcvar, studentTMonteCarloES=mces,
                            componentGaussianVaR=dict(zip(assets, component.tolist())), marginalGaussianVaR=dict(zip(assets, marginal_var.tolist())),
                            drawdownAtRiskPct=dar, maxDrawdownPct=mdd, seed=req.seed)


class LiquidityRiskPosition(BaseModel):
    name: str
    marketValue: float
    dailyVolumeValue: float = Field(gt=0.0)
    bidAskSpreadBps: float = Field(ge=0.0)
    dailyVolatilityPct: float = Field(ge=0.0)
    liquidationDays: float = Field(default=1.0, gt=0.0)


class LiquidityRiskRequest(BaseModel):
    positions: List[LiquidityRiskPosition]
    participationRatePct: float = Field(default=20.0, gt=0.0, le=100.0)
    confidencePct: float = Field(default=99.0, ge=90.0, le=99.9)


class LiquidityRiskResponse(BaseModel):
    estimatedLiquidationCost: float
    liquidityVaR: float
    daysToLiquidate: Dict[str, float]
    positionCosts: Dict[str, float]


def liquidity_var(req: LiquidityRiskRequest) -> LiquidityRiskResponse:
    if not req.positions:
        raise ValueError("At least one position required.")
    z = stats.norm.ppf(req.confidencePct / 100); rate = req.participationRatePct / 100
    costs, days, lvar_sq = {}, {}, 0.0
    for p in req.positions:
        absval = abs(p.marketValue); capacity = p.dailyVolumeValue * rate; d = max(p.liquidationDays, absval / capacity)
        spread_cost = absval * p.bidAskSpreadBps / 20000
        impact = absval * (p.dailyVolatilityPct / 100) * math.sqrt(max(absval / p.dailyVolumeValue, 0)) * 0.5
        cost = spread_cost + impact; risk = absval * (p.dailyVolatilityPct / 100) * math.sqrt(d) * z + cost
        costs[p.name], days[p.name] = float(cost), float(d); lvar_sq += risk * risk
    return LiquidityRiskResponse(estimatedLiquidationCost=float(sum(costs.values())), liquidityVaR=float(math.sqrt(lvar_sq)), daysToLiquidate=days, positionCosts=costs)


class ReverseStressRequest(BaseModel):
    assets: List[str]
    weights: List[float]
    covMatrixPct2: List[List[float]]
    targetPortfolioLossPct: float = Field(gt=0.0)


class ReverseStressResponse(BaseModel):
    minimumMahalanobisShock: Dict[str, float]
    portfolioReturnPct: float
    mahalanobisDistance: float


def reverse_stress(req: ReverseStressRequest) -> ReverseStressResponse:
    a = list(req.assets); w = np.asarray(req.weights, float); cov = np.asarray(req.covMatrixPct2, float); n = len(a)
    if n < 1 or w.shape != (n,) or cov.shape != (n, n):
        raise ValueError("Reverse-stress dimensions invalid.")
    if not np.allclose(cov, cov.T, atol=1e-10) or float(np.linalg.eigvalsh(cov).min()) <= 1e-12:
        raise ValueError("covMatrixPct2 must be symmetric positive definite.")
    target = -abs(req.targetPortfolioLossPct); denom = float(w @ cov @ w)
    if denom <= 1e-18:
        raise ValueError("Portfolio has zero variance under supplied covariance.")
    x = target * (cov @ w) / denom; md = math.sqrt(float(x @ np.linalg.solve(cov, x)))
    return ReverseStressResponse(minimumMahalanobisShock=dict(zip(a, x.tolist())), portfolioReturnPct=float(w @ x), mahalanobisDistance=float(md))


class CorrelationBreakdownRequest(BaseModel):
    assets: List[str]
    weights: List[float]
    assetVolatilityPct: List[float]
    baseCorrelationMatrix: List[List[float]]
    stressedPairwiseCorrelation: float = Field(default=0.8, ge=-0.99, le=0.999)


class CorrelationBreakdownResponse(BaseModel):
    baseVolatilityPct: float
    stressedVolatilityPct: float
    volatilityIncreasePct: float


def correlation_breakdown(req: CorrelationBreakdownRequest) -> CorrelationBreakdownResponse:
    n = len(req.assets); w = np.asarray(req.weights, float); v = np.asarray(req.assetVolatilityPct, float); C = np.asarray(req.baseCorrelationMatrix, float)
    if w.shape != (n,) or v.shape != (n,) or C.shape != (n, n) or np.any(v < 0):
        raise ValueError("Correlation-stress dimensions invalid.")
    if not np.allclose(C, C.T, atol=1e-10) or np.any(np.abs(C) > 1 + 1e-10):
        raise ValueError("Invalid correlation matrix.")
    stress = np.full((n, n), req.stressedPairwiseCorrelation); np.fill_diagonal(stress, 1.0)
    base = np.outer(v, v) * C; scov = np.outer(v, v) * stress
    bv = math.sqrt(max(0, float(w @ base @ w))); sv = math.sqrt(max(0, float(w @ scov @ w)))
    return CorrelationBreakdownResponse(baseVolatilityPct=bv, stressedVolatilityPct=sv, volatilityIncreasePct=(sv / bv - 1) * 100 if bv > 1e-12 else 0.0)
