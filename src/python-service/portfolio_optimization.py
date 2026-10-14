"""
Institutional portfolio construction via scipy.optimize.

The simple min-variance, max-Sharpe, efficient-frontier, risk-parity and
Mean-CVaR endpoints remain available. The robust constrained optimizer adds
controls that matter in a real mandate: estimation uncertainty, covariance
shrinkage, current holdings, turnover, transaction costs, per-asset bounds,
group constraints, target returns and gross-exposure limits.
"""

from typing import Dict, List, Optional

import numpy as np
from pydantic import BaseModel, Field
from scipy import optimize


class MeanVarianceRequest(BaseModel):
    assets: List[str]
    expectedReturns: List[float]
    covMatrix: List[List[float]]
    allowShort: bool = False


class WeightsResponse(BaseModel):
    weights: dict
    expectedReturnPct: float
    volatilityPct: float
    sharpeRatio: Optional[float] = None


def _bounds(n: int, allow_short: bool):
    return tuple((-1.0, 1.0) if allow_short else (0.0, 1.0) for _ in range(n))


def _sum_to_one():
    return {"type": "eq", "fun": lambda w: np.sum(w) - 1.0}


def _port_stats(w: np.ndarray, mu: np.ndarray, cov: np.ndarray):
    ret = float(w @ mu)
    vol = float(np.sqrt(max(0.0, w @ cov @ w)))
    return ret, vol


def _validated_mean_variance_inputs(req: MeanVarianceRequest):
    assets = list(req.assets)
    if len(assets) < 2:
        raise ValueError("At least two assets are required.")
    if len(set(assets)) != len(assets):
        raise ValueError("Asset identifiers must be unique.")

    mu = np.asarray(req.expectedReturns, dtype=float)
    cov = np.asarray(req.covMatrix, dtype=float)
    n = len(assets)
    if mu.shape != (n,):
        raise ValueError("expectedReturns length must match assets.")
    if cov.shape != (n, n):
        raise ValueError("covMatrix must be square with one row/column per asset.")
    if not np.all(np.isfinite(mu)) or not np.all(np.isfinite(cov)):
        raise ValueError("Portfolio inputs must be finite.")
    if not np.allclose(cov, cov.T, atol=1e-10, rtol=1e-10):
        raise ValueError("covMatrix must be symmetric.")
    eig_min = float(np.linalg.eigvalsh(cov).min())
    if eig_min < -1e-8:
        raise ValueError(f"covMatrix must be positive semidefinite; minimum eigenvalue={eig_min:.6g}.")
    return assets, mu, cov


def min_variance(req: MeanVarianceRequest) -> WeightsResponse:
    assets, mu, cov = _validated_mean_variance_inputs(req)
    n = len(mu)
    w0 = np.ones(n) / n
    res = optimize.minimize(
        lambda w: w @ cov @ w, w0, method="SLSQP",
        bounds=_bounds(n, req.allowShort), constraints=[_sum_to_one()],
    )
    if not res.success:
        raise ValueError(f"Min-variance optimization did not converge: {res.message}")
    ret, vol = _port_stats(res.x, mu, cov)
    return WeightsResponse(weights=dict(zip(assets, res.x.tolist())), expectedReturnPct=ret, volatilityPct=vol)


class MaxSharpeRequest(MeanVarianceRequest):
    riskFreeRatePct: float = 0.0


def max_sharpe(req: MaxSharpeRequest) -> WeightsResponse:
    assets, mu, cov = _validated_mean_variance_inputs(req)
    n = len(mu)
    w0 = np.ones(n) / n
    rf = req.riskFreeRatePct

    def neg_sharpe(w):
        ret, vol = _port_stats(w, mu, cov)
        return -(ret - rf) / vol if vol > 1e-12 else 0.0

    res = optimize.minimize(
        neg_sharpe, w0, method="SLSQP",
        bounds=_bounds(n, req.allowShort), constraints=[_sum_to_one()],
    )
    if not res.success:
        raise ValueError(f"Max-Sharpe optimization did not converge: {res.message}")
    ret, vol = _port_stats(res.x, mu, cov)
    sharpe = (ret - rf) / vol if vol > 1e-12 else None
    return WeightsResponse(weights=dict(zip(assets, res.x.tolist())), expectedReturnPct=ret, volatilityPct=vol, sharpeRatio=sharpe)


class EfficientFrontierRequest(MeanVarianceRequest):
    nPoints: int = 20


class FrontierPoint(BaseModel):
    expectedReturnPct: float
    volatilityPct: float
    weights: dict


class EfficientFrontierResponse(BaseModel):
    points: List[FrontierPoint]


def efficient_frontier(req: EfficientFrontierRequest) -> EfficientFrontierResponse:
    assets, mu, cov = _validated_mean_variance_inputs(req)
    n = len(mu)
    lo, hi = float(np.min(mu)), float(np.max(mu))
    targets = np.linspace(lo, hi, max(2, req.nPoints))
    points: List[FrontierPoint] = []
    for target in targets:
        cons = [_sum_to_one(), {"type": "eq", "fun": lambda w, t=target: w @ mu - t}]
        res = optimize.minimize(
            lambda w: w @ cov @ w, np.ones(n) / n, method="SLSQP",
            bounds=_bounds(n, req.allowShort), constraints=cons,
        )
        if res.success:
            ret, vol = _port_stats(res.x, mu, cov)
            points.append(FrontierPoint(expectedReturnPct=ret, volatilityPct=vol, weights=dict(zip(assets, res.x.tolist()))))
    return EfficientFrontierResponse(points=points)


class CovOnlyRequest(BaseModel):
    assets: List[str]
    covMatrix: List[List[float]]


def _validated_cov_inputs(req: CovOnlyRequest):
    assets = list(req.assets)
    if len(assets) < 2 or len(set(assets)) != len(assets):
        raise ValueError("At least two unique assets are required.")
    cov = np.asarray(req.covMatrix, dtype=float)
    n = len(assets)
    if cov.shape != (n, n):
        raise ValueError("covMatrix must be square with one row/column per asset.")
    if not np.all(np.isfinite(cov)) or not np.allclose(cov, cov.T, atol=1e-10, rtol=1e-10):
        raise ValueError("covMatrix must be finite and symmetric.")
    eig_min = float(np.linalg.eigvalsh(cov).min())
    if eig_min < -1e-8:
        raise ValueError(f"covMatrix must be positive semidefinite; minimum eigenvalue={eig_min:.6g}.")
    return assets, cov


def risk_parity(req: CovOnlyRequest) -> WeightsResponse:
    assets, cov = _validated_cov_inputs(req)
    n = len(cov)

    def risk_budget_objective(w):
        port_var = w @ cov @ w
        marginal_risk = cov @ w
        risk_contribution = w * marginal_risk
        target_risk = port_var / n
        return np.sum((risk_contribution - target_risk) ** 2)

    res = optimize.minimize(
        risk_budget_objective, np.ones(n) / n, method="SLSQP",
        bounds=_bounds(n, False), constraints=[_sum_to_one()],
    )
    if not res.success:
        raise ValueError(f"Risk parity optimization did not converge: {res.message}")
    vol = float(np.sqrt(max(0.0, res.x @ cov @ res.x)))
    return WeightsResponse(weights=dict(zip(assets, res.x.tolist())), expectedReturnPct=0.0, volatilityPct=vol)


class MaxDiversificationRequest(CovOnlyRequest):
    assetVolsPct: List[float]


def max_diversification(req: MaxDiversificationRequest) -> WeightsResponse:
    assets, cov = _validated_cov_inputs(req)
    vols = np.array(req.assetVolsPct)
    n = len(cov)
    if vols.shape != (n,) or not np.all(np.isfinite(vols)) or np.any(vols < 0):
        raise ValueError("assetVolsPct must contain one finite non-negative volatility per asset.")

    def neg_div_ratio(w):
        port_vol = np.sqrt(max(1e-12, w @ cov @ w))
        weighted_vols = w @ vols
        return -weighted_vols / port_vol

    res = optimize.minimize(
        neg_div_ratio, np.ones(n) / n, method="SLSQP",
        bounds=_bounds(n, False), constraints=[_sum_to_one()],
    )
    if not res.success:
        raise ValueError(f"Max diversification optimization did not converge: {res.message}")
    vol = float(np.sqrt(max(0.0, res.x @ cov @ res.x)))
    return WeightsResponse(weights=dict(zip(assets, res.x.tolist())), expectedReturnPct=0.0, volatilityPct=vol)


class MeanCVaRRequest(BaseModel):
    assets: List[str]
    returnsMatrixPct: List[List[float]]
    confidence: float = Field(default=95.0, ge=50, le=99.9)
    targetReturnPct: Optional[float] = None
    allowShort: bool = False


class MeanCVaRResponse(BaseModel):
    weights: dict
    expectedReturnPct: float
    cvarPct: float


def mean_cvar_optimization(req: MeanCVaRRequest) -> MeanCVaRResponse:
    assets = list(req.assets)
    if len(assets) < 2 or len(set(assets)) != len(assets):
        raise ValueError("At least two unique assets are required.")
    R = np.asarray(req.returnsMatrixPct, dtype=float) / 100.0
    if R.ndim != 2 or R.shape[1] != len(assets) or R.shape[0] < 10 or not np.all(np.isfinite(R)):
        raise ValueError("returnsMatrixPct must contain at least 10 finite scenarios with one column per asset.")
    T, n = R.shape
    alpha = req.confidence / 100.0

    n_vars = n + 1 + T
    c = np.zeros(n_vars)
    c[n] = 1.0
    c[n + 1:] = 1.0 / ((1.0 - alpha) * T)

    A_ub = np.zeros((T, n_vars))
    A_ub[:, :n] = -R
    A_ub[:, n] = -1.0
    A_ub[:, n + 1:] = -np.eye(T)
    b_ub = np.zeros(T)

    A_eq = np.zeros((1, n_vars))
    A_eq[0, :n] = 1.0
    b_eq = np.array([1.0])

    if req.targetReturnPct is not None:
        mean_returns = R.mean(axis=0)
        target = req.targetReturnPct / 100.0
        extra_row = np.zeros((1, n_vars))
        extra_row[0, :n] = -mean_returns
        A_ub = np.vstack([A_ub, extra_row])
        b_ub = np.append(b_ub, -target)

    w_bound = (-1.0, 1.0) if req.allowShort else (0.0, 1.0)
    bounds = [w_bound] * n + [(None, None)] + [(0.0, None)] * T

    res = optimize.linprog(c, A_ub=A_ub, b_ub=b_ub, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method="highs")
    if not res.success:
        raise ValueError(f"Mean-CVaR optimization did not converge: {res.message}")

    w = res.x[:n]
    mean_returns = R.mean(axis=0)
    ret = float(w @ mean_returns) * 100.0
    port_scenario_returns = R @ w
    cvar_cutoff = np.percentile(port_scenario_returns, (1 - alpha) * 100)
    tail = port_scenario_returns[port_scenario_returns <= cvar_cutoff]
    cvar_pct = float(-tail.mean()) * 100.0 if len(tail) else 0.0

    return MeanCVaRResponse(weights=dict(zip(assets, w.tolist())), expectedReturnPct=ret, cvarPct=cvar_pct)


class AssetWeightBound(BaseModel):
    asset: str
    minWeight: float = -1.0
    maxWeight: float = 1.0


class GroupWeightConstraint(BaseModel):
    name: str
    assets: List[str]
    minWeight: Optional[float] = None
    maxWeight: Optional[float] = None


class RobustPortfolioRequest(MeanVarianceRequest):
    currentWeights: Optional[List[float]] = None
    assetBounds: List[AssetWeightBound] = Field(default_factory=list)
    groupConstraints: List[GroupWeightConstraint] = Field(default_factory=list)
    turnoverLimit: Optional[float] = Field(default=None, ge=0.0, le=4.0)
    transactionCostBps: Optional[List[float]] = None
    meanUncertaintyPct: Optional[List[float]] = None
    uncertaintyAversion: float = Field(default=1.0, ge=0.0, le=100.0)
    riskAversion: float = Field(default=1.0, gt=0.0, le=1000.0)
    covarianceShrinkage: float = Field(default=0.0, ge=0.0, le=1.0)
    targetReturnPct: Optional[float] = None
    maxGrossExposure: float = Field(default=1.0, ge=1.0, le=5.0)


class RobustPortfolioResponse(BaseModel):
    weights: Dict[str, float]
    expectedReturnPct: float
    volatilityPct: float
    objectiveValue: float
    turnover: float
    estimatedTransactionCostPct: float
    meanUncertaintyPenaltyPct: float
    covarianceShrinkage: float
    grossExposure: float
    constraintSlack: Dict[str, float]


def robust_constrained_optimization(req: RobustPortfolioRequest) -> RobustPortfolioResponse:
    assets, mu, raw_cov = _validated_mean_variance_inputs(req)
    n = len(assets)

    shrink = float(req.covarianceShrinkage)
    cov = (1.0 - shrink) * raw_cov + shrink * np.diag(np.diag(raw_cov))
    eig_min = float(np.linalg.eigvalsh(cov).min())
    if eig_min < -1e-8:
        raise ValueError(f"Shrunk covariance matrix is not positive semidefinite; minimum eigenvalue={eig_min:.6g}.")

    current = np.asarray(req.currentWeights if req.currentWeights is not None else np.ones(n) / n, dtype=float)
    if current.shape != (n,) or not np.all(np.isfinite(current)):
        raise ValueError("currentWeights must contain one finite value per asset.")
    if abs(float(current.sum()) - 1.0) > 1e-6:
        raise ValueError("currentWeights must sum to 1.")

    costs = np.asarray(req.transactionCostBps if req.transactionCostBps is not None else np.zeros(n), dtype=float)
    if costs.shape != (n,) or not np.all(np.isfinite(costs)) or np.any(costs < 0):
        raise ValueError("transactionCostBps must contain one finite non-negative value per asset.")

    uncertainty = np.asarray(req.meanUncertaintyPct if req.meanUncertaintyPct is not None else np.zeros(n), dtype=float)
    if uncertainty.shape != (n,) or not np.all(np.isfinite(uncertainty)) or np.any(uncertainty < 0):
        raise ValueError("meanUncertaintyPct must contain one finite non-negative value per asset.")

    bounds_by_asset = {asset: (-1.0, 1.0) if req.allowShort else (0.0, 1.0) for asset in assets}
    for bound in req.assetBounds:
        if bound.asset not in bounds_by_asset:
            raise ValueError(f"Unknown asset in assetBounds: {bound.asset}")
        lo, hi = float(bound.minWeight), float(bound.maxWeight)
        if lo > hi:
            raise ValueError(f"Invalid bounds for {bound.asset}: minWeight exceeds maxWeight.")
        if not req.allowShort and lo < 0:
            raise ValueError(f"Negative minimum weight for {bound.asset} requires allowShort=true.")
        bounds_by_asset[bound.asset] = (lo, hi)
    bounds = tuple(bounds_by_asset[asset] for asset in assets)

    asset_index = {asset: idx for idx, asset in enumerate(assets)}
    constraints = [_sum_to_one()]
    slack_names = []

    if req.targetReturnPct is not None:
        target = float(req.targetReturnPct)
        constraints.append({"type": "ineq", "fun": lambda w, t=target: float(w @ mu) - t})
        slack_names.append(("targetReturn", lambda w, t=target: float(w @ mu) - t))

    if req.turnoverLimit is not None:
        limit = float(req.turnoverLimit)
        constraints.append({"type": "ineq", "fun": lambda w, lim=limit: lim - float(np.abs(w - current).sum())})
        slack_names.append(("turnover", lambda w, lim=limit: lim - float(np.abs(w - current).sum())))

    gross_limit = float(req.maxGrossExposure)
    constraints.append({"type": "ineq", "fun": lambda w, lim=gross_limit: lim - float(np.abs(w).sum())})
    slack_names.append(("grossExposure", lambda w, lim=gross_limit: lim - float(np.abs(w).sum())))

    seen_group_names = set()
    for group in req.groupConstraints:
        if group.name in seen_group_names:
            raise ValueError(f"Duplicate group constraint name: {group.name}")
        seen_group_names.add(group.name)
        if not group.assets:
            raise ValueError(f"Group {group.name} must contain at least one asset.")
        try:
            idxs = np.array([asset_index[asset] for asset in group.assets], dtype=int)
        except KeyError as exc:
            raise ValueError(f"Unknown asset in group {group.name}: {exc.args[0]}") from exc
        if group.minWeight is not None:
            minimum = float(group.minWeight)
            constraints.append({"type": "ineq", "fun": lambda w, ids=idxs, lo=minimum: float(w[ids].sum()) - lo})
            slack_names.append((f"group:{group.name}:min", lambda w, ids=idxs, lo=minimum: float(w[ids].sum()) - lo))
        if group.maxWeight is not None:
            maximum = float(group.maxWeight)
            constraints.append({"type": "ineq", "fun": lambda w, ids=idxs, hi=maximum: hi - float(w[ids].sum())})
            slack_names.append((f"group:{group.name}:max", lambda w, ids=idxs, hi=maximum: hi - float(w[ids].sum())))

    def components(w):
        variance = float(w @ cov @ w)
        expected_return = float(w @ mu)
        turnover = float(np.abs(w - current).sum())
        tx_cost_pct = float(np.abs(w - current) @ costs) / 100.0
        mean_uncertainty_penalty = float(np.sqrt(np.sum((uncertainty * w) ** 2)))
        objective = (
            req.riskAversion * variance
            - expected_return
            + req.uncertaintyAversion * mean_uncertainty_penalty
            + tx_cost_pct
        )
        return objective, expected_return, variance, turnover, tx_cost_pct, mean_uncertainty_penalty

    x0 = current.copy()
    feasible_bounds = all(lo - 1e-12 <= x0[i] <= hi + 1e-12 for i, (lo, hi) in enumerate(bounds))
    if not feasible_bounds or any(float(cons["fun"](x0)) < -1e-8 for cons in constraints):
        x0 = np.ones(n) / n

    res = optimize.minimize(
        lambda w: components(w)[0],
        x0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"maxiter": 2000, "ftol": 1e-12},
    )
    if not res.success:
        raise ValueError(f"Robust constrained optimization did not converge: {res.message}")

    w = np.asarray(res.x, dtype=float)
    violations = [float(cons["fun"](w)) for cons in constraints if cons["type"] == "ineq"]
    if violations and min(violations) < -1e-6:
        raise ValueError(f"Optimizer returned an infeasible solution; worst constraint slack={min(violations):.6g}.")

    objective, expected_return, variance, turnover, tx_cost_pct, mean_uncertainty_penalty = components(w)
    return RobustPortfolioResponse(
        weights=dict(zip(assets, w.tolist())),
        expectedReturnPct=expected_return,
        volatilityPct=float(np.sqrt(max(0.0, variance))),
        objectiveValue=objective,
        turnover=turnover,
        estimatedTransactionCostPct=tx_cost_pct,
        meanUncertaintyPenaltyPct=mean_uncertainty_penalty,
        covarianceShrinkage=shrink,
        grossExposure=float(np.abs(w).sum()),
        constraintSlack={name: float(fn(w)) for name, fn in slack_names},
    )
