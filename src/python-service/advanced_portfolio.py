"""Advanced portfolio construction beyond classical mean-variance.

Includes HRP, custom risk budgets, factor-risk constraints, benchmark tracking,
tax-aware rebalancing, stress-aware optimisation and regime-conditioned blends.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np
from pydantic import BaseModel, Field
from scipy import optimize
from scipy.cluster.hierarchy import linkage, leaves_list
from scipy.spatial.distance import squareform


class HrpRequest(BaseModel):
    assets: List[str]
    covMatrix: List[List[float]]


class WeightsResponse(BaseModel):
    weights: Dict[str, float]


def _validate_cov(assets: List[str], cov_input: List[List[float]]) -> np.ndarray:
    if len(assets) < 2 or len(set(assets)) != len(assets):
        raise ValueError("At least two unique assets are required.")
    cov = np.asarray(cov_input, dtype=float)
    n = len(assets)
    if cov.shape != (n, n) or not np.all(np.isfinite(cov)):
        raise ValueError("covMatrix must be finite and square with one row per asset.")
    if not np.allclose(cov, cov.T, atol=1e-10, rtol=1e-10):
        raise ValueError("covMatrix must be symmetric.")
    if float(np.linalg.eigvalsh(cov).min()) < -1e-8:
        raise ValueError("covMatrix must be positive semidefinite.")
    return cov


def hierarchical_risk_parity(req: HrpRequest) -> WeightsResponse:
    cov = _validate_cov(req.assets, req.covMatrix)
    vol = np.sqrt(np.maximum(np.diag(cov), 1e-18))
    corr = cov / np.outer(vol, vol)
    corr = np.clip(corr, -1.0, 1.0)
    dist = np.sqrt(np.maximum(0.0, 0.5 * (1.0 - corr)))
    np.fill_diagonal(dist, 0.0)
    order = leaves_list(linkage(squareform(dist, checks=False), method="single")).tolist()
    weights = np.ones(len(req.assets), dtype=float)

    def cluster_variance(indices: List[int]) -> float:
        sub = cov[np.ix_(indices, indices)]
        ivp = 1.0 / np.maximum(np.diag(sub), 1e-18)
        ivp /= ivp.sum()
        return float(ivp @ sub @ ivp)

    clusters = [order]
    while clusters:
        cluster = clusters.pop(0)
        if len(cluster) <= 1:
            continue
        split = len(cluster) // 2
        left, right = cluster[:split], cluster[split:]
        lv, rv = cluster_variance(left), cluster_variance(right)
        alpha = 1.0 - lv / max(lv + rv, 1e-18)
        weights[left] *= alpha
        weights[right] *= 1.0 - alpha
        clusters.extend([left, right])
    weights /= weights.sum()
    return WeightsResponse(weights={asset: float(weights[i]) for i, asset in enumerate(req.assets)})


class RiskBudgetRequest(BaseModel):
    assets: List[str]
    covMatrix: List[List[float]]
    riskBudgets: List[float]
    allowShort: bool = False


class RiskBudgetResponse(BaseModel):
    weights: Dict[str, float]
    riskContributions: Dict[str, float]
    budgetError: float


def risk_budget_optimization(req: RiskBudgetRequest) -> RiskBudgetResponse:
    cov = _validate_cov(req.assets, req.covMatrix)
    budgets = np.asarray(req.riskBudgets, dtype=float)
    n = len(req.assets)
    if budgets.shape != (n,) or np.any(budgets < 0) or not np.all(np.isfinite(budgets)) or budgets.sum() <= 0:
        raise ValueError("riskBudgets must be finite, non-negative and contain one value per asset.")
    budgets /= budgets.sum()

    def contributions(w: np.ndarray) -> np.ndarray:
        total_var = float(w @ cov @ w)
        if total_var <= 1e-18:
            return np.zeros(n)
        rc = w * (cov @ w) / total_var
        return rc

    bounds = [(-1.0, 1.0) if req.allowShort else (0.0, 1.0)] * n
    res = optimize.minimize(
        lambda w: float(np.sum((contributions(w) - budgets) ** 2)),
        np.ones(n) / n,
        method="SLSQP",
        bounds=bounds,
        constraints=[{"type": "eq", "fun": lambda w: float(w.sum() - 1.0)}],
        options={"maxiter": 3000, "ftol": 1e-12},
    )
    if not res.success:
        raise ValueError(f"Risk-budget optimisation failed: {res.message}")
    rc = contributions(res.x)
    return RiskBudgetResponse(weights=dict(zip(req.assets, map(float, res.x))), riskContributions=dict(zip(req.assets, map(float, rc))), budgetError=float(np.linalg.norm(rc - budgets)))


class FactorRiskRequest(BaseModel):
    assets: List[str]
    expectedReturnsPct: List[float]
    factorLoadings: List[List[float]]
    factorCovMatrix: List[List[float]]
    idiosyncraticVariancePct2: List[float]
    maxFactorExposureAbs: Optional[List[float]] = None
    riskAversion: float = Field(default=1.0, gt=0)


class FactorRiskResponse(BaseModel):
    weights: Dict[str, float]
    factorExposures: List[float]
    expectedReturnPct: float
    volatilityPct: float


def factor_risk_optimize(req: FactorRiskRequest) -> FactorRiskResponse:
    n = len(req.assets)
    if n < 1 or len(set(req.assets)) != n:
        raise ValueError("Factor model assets must be non-empty and unique.")
    mu = np.asarray(req.expectedReturnsPct, dtype=float)
    B = np.asarray(req.factorLoadings, dtype=float)
    F = np.asarray(req.factorCovMatrix, dtype=float)
    idio = np.asarray(req.idiosyncraticVariancePct2, dtype=float)
    if mu.shape != (n,) or B.ndim != 2 or B.shape[0] != n or idio.shape != (n,):
        raise ValueError("Factor model dimensions do not match assets.")
    k = B.shape[1]
    if F.shape != (k, k):
        raise ValueError("factorCovMatrix dimensions must match factor loadings.")
    if not np.all(np.isfinite(mu)) or not np.all(np.isfinite(B)) or not np.all(np.isfinite(F)) or not np.all(np.isfinite(idio)):
        raise ValueError("Factor model returns, loadings, covariance and idiosyncratic variances must be finite.")
    if np.any(idio < 0):
        raise ValueError("Factor model idiosyncratic variances must be non-negative.")
    if not np.allclose(F, F.T, atol=1e-10, rtol=1e-10):
        raise ValueError("factorCovMatrix must be symmetric.")
    if k and float(np.linalg.eigvalsh(F).min()) < -1e-8:
        raise ValueError("factorCovMatrix must be positive semidefinite.")
    cov = B @ F @ B.T + np.diag(idio)
    constraints = [{"type": "eq", "fun": lambda w: float(w.sum() - 1.0)}]
    if req.maxFactorExposureAbs is not None:
        caps = np.asarray(req.maxFactorExposureAbs, dtype=float)
        if caps.shape != (k,) or not np.all(np.isfinite(caps)):
            raise ValueError("maxFactorExposureAbs must be finite and contain one cap per factor.")
        if np.any(caps < 0):
            raise ValueError("maxFactorExposureAbs must contain one non-negative cap per factor.")
        for j in range(k):
            constraints.append({"type": "ineq", "fun": lambda w, j=j: float(caps[j] - (w @ B[:, j]))})
            constraints.append({"type": "ineq", "fun": lambda w, j=j: float(caps[j] + (w @ B[:, j]))})
    res = optimize.minimize(
        lambda w: float(req.riskAversion * (w @ cov @ w) - (w @ mu)),
        np.ones(n) / n,
        method="SLSQP",
        bounds=[(0.0, 1.0)] * n,
        constraints=constraints,
    )
    if not res.success:
        raise ValueError(f"Factor-risk optimisation failed: {res.message}")
    vol = float(np.sqrt(max(0.0, res.x @ cov @ res.x)))
    return FactorRiskResponse(weights=dict(zip(req.assets, map(float, res.x))), factorExposures=list(map(float, res.x @ B)), expectedReturnPct=float(res.x @ mu), volatilityPct=vol)


class TrackingErrorRequest(BaseModel):
    assets: List[str]
    expectedReturnsPct: List[float]
    covMatrix: List[List[float]]
    benchmarkWeights: List[float]
    maxTrackingErrorPct: float = Field(gt=0)
    minActiveReturnPct: Optional[float] = None


class TrackingErrorResponse(BaseModel):
    weights: Dict[str, float]
    trackingErrorPct: float
    expectedActiveReturnPct: float


def tracking_error_optimize(req: TrackingErrorRequest) -> TrackingErrorResponse:
    cov = _validate_cov(req.assets, req.covMatrix)
    mu = np.asarray(req.expectedReturnsPct, dtype=float)
    b = np.asarray(req.benchmarkWeights, dtype=float)
    n = len(req.assets)
    if mu.shape != (n,) or b.shape != (n,) or abs(float(b.sum()) - 1.0) > 1e-6:
        raise ValueError("benchmarkWeights and expectedReturnsPct must match assets; benchmark weights must sum to 1.")
    constraints = [
        {"type": "eq", "fun": lambda w: float(w.sum() - 1.0)},
        {"type": "ineq", "fun": lambda w: float(req.maxTrackingErrorPct ** 2 - ((w - b) @ cov @ (w - b)))},
    ]
    if req.minActiveReturnPct is not None:
        constraints.append({"type": "ineq", "fun": lambda w: float((w - b) @ mu - req.minActiveReturnPct)})
    res = optimize.minimize(lambda w: -float((w - b) @ mu), b.copy(), method="SLSQP", bounds=[(0.0, 1.0)] * n, constraints=constraints)
    if not res.success:
        raise ValueError(f"Tracking-error optimisation failed: {res.message}")
    active = res.x - b
    te = float(np.sqrt(max(0.0, active @ cov @ active)))
    return TrackingErrorResponse(weights=dict(zip(req.assets, map(float, res.x))), trackingErrorPct=te, expectedActiveReturnPct=float(active @ mu))


class TaxLot(BaseModel):
    asset: str
    currentWeight: float = Field(ge=0)
    costBasisWeightEquivalent: float = Field(ge=0)
    unrealizedGainPct: float


class TaxAwareRequest(BaseModel):
    assets: List[str]
    targetWeights: List[float]
    lots: List[TaxLot]
    taxRatePct: float = Field(ge=0, le=100)
    turnoverPenalty: float = Field(default=1.0, ge=0)
    taxPenalty: float = Field(default=1.0, ge=0)


class TaxAwareResponse(BaseModel):
    weights: Dict[str, float]
    estimatedTaxCostPct: float
    turnover: float
    trackingErrorL2: float


def tax_aware_rebalance(req: TaxAwareRequest) -> TaxAwareResponse:
    n = len(req.assets)
    target = np.asarray(req.targetWeights, dtype=float)
    if target.shape != (n,) or abs(float(target.sum()) - 1.0) > 1e-6:
        raise ValueError("targetWeights must match assets and sum to 1.")
    lot_map = {lot.asset: lot for lot in req.lots}
    if set(lot_map) != set(req.assets):
        raise ValueError("Exactly one tax lot summary is required per asset.")
    current = np.array([lot_map[a].currentWeight for a in req.assets], dtype=float)
    if abs(float(current.sum()) - 1.0) > 1e-6:
        raise ValueError("Current lot weights must sum to 1.")
    gains = np.array([max(0.0, lot_map[a].unrealizedGainPct) / 100.0 for a in req.assets])
    tax_rate = req.taxRatePct / 100.0

    def costs(w: np.ndarray):
        sells = np.maximum(current - w, 0.0)
        tax = float(np.sum(sells * gains * tax_rate) * 100.0)
        turnover = float(np.sum(np.abs(w - current)))
        tracking = float(np.linalg.norm(w - target))
        objective = tracking ** 2 + req.turnoverPenalty * turnover + req.taxPenalty * tax
        return objective, tax, turnover, tracking

    res = optimize.minimize(lambda w: costs(w)[0], current, method="SLSQP", bounds=[(0.0, 1.0)] * n, constraints=[{"type": "eq", "fun": lambda w: float(w.sum() - 1.0)}])
    if not res.success:
        raise ValueError(f"Tax-aware rebalancing failed: {res.message}")
    _, tax, turnover, tracking = costs(res.x)
    return TaxAwareResponse(weights=dict(zip(req.assets, map(float, res.x))), estimatedTaxCostPct=tax, turnover=turnover, trackingErrorL2=tracking)


class StressScenario(BaseModel):
    name: str
    assetReturnsPct: List[float]
    probability: float = Field(ge=0, le=1)


class StressAwareRequest(BaseModel):
    assets: List[str]
    expectedReturnsPct: List[float]
    covMatrix: List[List[float]]
    scenarios: List[StressScenario]
    maxExpectedStressLossPct: Optional[float] = Field(default=None, ge=0)
    riskAversion: float = Field(default=1.0, gt=0)


class StressAwareResponse(BaseModel):
    weights: Dict[str, float]
    expectedStressLossPct: float
    worstScenarioLossPct: float


def stress_aware_optimize(req: StressAwareRequest) -> StressAwareResponse:
    cov = _validate_cov(req.assets, req.covMatrix)
    mu = np.asarray(req.expectedReturnsPct, dtype=float)
    n = len(req.assets)
    if mu.shape != (n,) or not req.scenarios:
        raise ValueError("Expected returns and at least one stress scenario are required.")
    matrix = np.asarray([s.assetReturnsPct for s in req.scenarios], dtype=float)
    probs = np.asarray([s.probability for s in req.scenarios], dtype=float)
    if matrix.shape[1] != n or probs.sum() <= 0:
        raise ValueError("Stress scenarios must contain one return per asset and positive total probability.")
    probs /= probs.sum()

    def expected_stress_loss(w: np.ndarray) -> float:
        scenario_returns = matrix @ w
        return float(np.sum(probs * np.maximum(-scenario_returns, 0.0)))

    constraints = [{"type": "eq", "fun": lambda w: float(w.sum() - 1.0)}]
    if req.maxExpectedStressLossPct is not None:
        constraints.append({"type": "ineq", "fun": lambda w: float(req.maxExpectedStressLossPct - expected_stress_loss(w))})
    res = optimize.minimize(lambda w: float(req.riskAversion * (w @ cov @ w) - w @ mu + expected_stress_loss(w)), np.ones(n) / n, method="SLSQP", bounds=[(0.0, 1.0)] * n, constraints=constraints)
    if not res.success:
        raise ValueError(f"Stress-aware optimisation failed: {res.message}")
    sr = matrix @ res.x
    return StressAwareResponse(weights=dict(zip(req.assets, map(float, res.x))), expectedStressLossPct=expected_stress_loss(res.x), worstScenarioLossPct=float(max(0.0, -sr.min())))


class RegimeBlendRequest(BaseModel):
    assets: List[str]
    regimeProbabilities: List[float]
    regimeWeights: List[List[float]]


class RegimeBlendResponse(BaseModel):
    weights: Dict[str, float]


def regime_conditioned_blend(req: RegimeBlendRequest) -> RegimeBlendResponse:
    probs = np.asarray(req.regimeProbabilities, dtype=float)
    W = np.asarray(req.regimeWeights, dtype=float)
    if W.ndim != 2 or W.shape[1] != len(req.assets) or W.shape[0] != len(probs):
        raise ValueError("regimeWeights must contain one asset-weight vector per regime probability.")
    if not np.all(np.isfinite(probs)) or not np.all(np.isfinite(W)):
        raise ValueError("Regime probabilities and weights must be finite.")
    if np.any(probs < 0) or probs.sum() <= 0 or np.any(W < -1e-12):
        raise ValueError("Regime probabilities and weights must be non-negative.")
    if not np.allclose(W.sum(axis=1), 1.0, atol=1e-6):
        raise ValueError("Each regime weight vector must sum to 1.")
    probs /= probs.sum()
    blended = probs @ W
    blended /= blended.sum()
    return RegimeBlendResponse(weights=dict(zip(req.assets, map(float, blended))))
