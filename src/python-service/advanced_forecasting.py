"""Advanced forecasting helpers with deterministic/seeded reproducibility."""
from __future__ import annotations

from typing import Dict, List, Literal, Optional

import numpy as np
from pydantic import BaseModel, Field
from scipy import stats


def _naive_forecast(y: np.ndarray, h: int) -> np.ndarray:
    return np.repeat(y[-1], h)


def _drift_forecast(y: np.ndarray, h: int) -> np.ndarray:
    if len(y) < 2:
        return _naive_forecast(y, h)
    slope = (y[-1] - y[0]) / (len(y) - 1)
    return y[-1] + slope * np.arange(1, h + 1)


def _ar1_fit(y: np.ndarray):
    X = np.column_stack([np.ones(len(y) - 1), y[:-1]])
    target = y[1:]
    beta, *_ = np.linalg.lstsq(X, target, rcond=None)
    resid = target - X @ beta
    sigma = float(resid.std(ddof=max(1, X.shape[1])))
    return float(beta[0]), float(beta[1]), sigma


def _ar1_forecast(y: np.ndarray, h: int) -> np.ndarray:
    a, b, _ = _ar1_fit(y)
    out = []
    prev = float(y[-1])
    for _ in range(h):
        prev = a + b * prev
        out.append(prev)
    return np.asarray(out)


class ForecastTournamentRequest(BaseModel):
    series: List[float]
    horizon: int = Field(default=8, ge=1, le=60)
    validationWindow: int = Field(default=24, ge=8, le=500)
    models: List[Literal["naive", "drift", "ar1"]] = Field(default_factory=lambda: ["naive", "drift", "ar1"])


class ForecastTournamentResponse(BaseModel):
    modelRmse: Dict[str, float]
    modelWeights: Dict[str, float]
    forecasts: Dict[str, List[float]]
    ensembleForecast: List[float]
    winner: str


def forecast_tournament(req: ForecastTournamentRequest) -> ForecastTournamentResponse:
    y = np.asarray(req.series, dtype=float)
    if len(y) < req.validationWindow + 10 or not np.all(np.isfinite(y)):
        raise ValueError("Insufficient finite history for rolling forecast tournament.")
    errors: Dict[str, List[float]] = {m: [] for m in req.models}
    start = len(y) - req.validationWindow
    for t in range(start, len(y)):
        train = y[:t]
        actual = y[t]
        if len(train) < 3:
            continue
        preds = {
            "naive": _naive_forecast(train, 1)[0],
            "drift": _drift_forecast(train, 1)[0],
            "ar1": _ar1_forecast(train, 1)[0],
        }
        for m in req.models:
            errors[m].append(float((preds[m] - actual) ** 2))
    rmse = {m: float(np.sqrt(np.mean(v))) for m, v in errors.items() if v}
    if not rmse:
        raise ValueError("No model produced validation errors.")
    inv = {m: 1.0 / max(v, 1e-12) for m, v in rmse.items()}
    total = sum(inv.values())
    weights = {m: v / total for m, v in inv.items()}
    forecasts: Dict[str, List[float]] = {}
    for m in req.models:
        if m == "naive": f = _naive_forecast(y, req.horizon)
        elif m == "drift": f = _drift_forecast(y, req.horizon)
        else: f = _ar1_forecast(y, req.horizon)
        forecasts[m] = list(map(float, f))
    ensemble = np.zeros(req.horizon)
    for m, w in weights.items(): ensemble += w * np.asarray(forecasts[m])
    winner = min(rmse, key=rmse.get)
    return ForecastTournamentResponse(modelRmse=rmse, modelWeights=weights, forecasts=forecasts, ensembleForecast=list(map(float, ensemble)), winner=winner)


class ProbabilisticForecastRequest(BaseModel):
    series: List[float]
    horizon: int = Field(default=8, ge=1, le=60)
    nSimulations: int = Field(default=20000, ge=1000, le=500000)
    seed: int = 42
    confidenceLevels: List[float] = Field(default_factory=lambda: [0.5, 0.8, 0.95])


class ProbabilisticForecastResponse(BaseModel):
    mean: List[float]
    median: List[float]
    quantiles: Dict[str, List[float]]
    seed: int


def probabilistic_ar1(req: ProbabilisticForecastRequest) -> ProbabilisticForecastResponse:
    y = np.asarray(req.series, dtype=float)
    if len(y) < 20:
        raise ValueError("At least 20 observations are required.")
    a, b, sigma = _ar1_fit(y)
    rng = np.random.default_rng(req.seed)
    sims = np.empty((req.nSimulations, req.horizon), dtype=float)
    prev = np.full(req.nSimulations, y[-1], dtype=float)
    for h in range(req.horizon):
        prev = a + b * prev + rng.normal(0.0, sigma, size=req.nSimulations)
        sims[:, h] = prev
    quantiles: Dict[str, List[float]] = {}
    for level in req.confidenceLevels:
        if not 0 < level < 1:
            raise ValueError("confidenceLevels must lie strictly between 0 and 1.")
        alpha = (1 - level) / 2
        quantiles[f"{level:.3f}_low"] = list(map(float, np.quantile(sims, alpha, axis=0)))
        quantiles[f"{level:.3f}_high"] = list(map(float, np.quantile(sims, 1 - alpha, axis=0)))
    return ProbabilisticForecastResponse(mean=list(map(float, sims.mean(axis=0))), median=list(map(float, np.median(sims, axis=0))), quantiles=quantiles, seed=req.seed)


class HierarchicalForecastRequest(BaseModel):
    seriesNames: List[str]
    baseForecasts: Dict[str, List[float]]
    hierarchy: Dict[str, List[str]]


class HierarchicalForecastResponse(BaseModel):
    reconciledForecasts: Dict[str, List[float]]
    maxAggregationError: float


def reconcile_hierarchy(req: HierarchicalForecastRequest) -> HierarchicalForecastResponse:
    forecasts = {k: np.asarray(v, dtype=float) for k, v in req.baseForecasts.items()}
    lengths = {len(v) for v in forecasts.values()}
    if len(lengths) != 1:
        raise ValueError("All base forecasts must have the same horizon.")
    for parent, children in req.hierarchy.items():
        if parent not in forecasts or any(c not in forecasts for c in children):
            raise ValueError("Hierarchy references an unknown series.")
    reconciled = {k: v.copy() for k, v in forecasts.items()}
    for parent, children in req.hierarchy.items():
        child_sum = sum((reconciled[c] for c in children), start=np.zeros(next(iter(lengths))))
        parent_base = reconciled[parent]
        gap = parent_base - child_sum
        child_scales = np.array([max(np.mean(np.abs(reconciled[c])), 1e-12) for c in children])
        child_scales /= child_scales.sum()
        for scale, child in zip(child_scales, children):
            reconciled[child] = reconciled[child] + gap * scale
        reconciled[parent] = sum((reconciled[c] for c in children), start=np.zeros_like(parent_base))
    max_error = 0.0
    for parent, children in req.hierarchy.items():
        err = np.max(np.abs(reconciled[parent] - sum((reconciled[c] for c in children), start=np.zeros_like(reconciled[parent]))))
        max_error = max(max_error, float(err))
    return HierarchicalForecastResponse(reconciledForecasts={k: list(map(float, v)) for k, v in reconciled.items()}, maxAggregationError=max_error)


class NowcastRequest(BaseModel):
    targetHistory: List[float]
    indicatorHistory: List[List[float]]
    currentIndicators: List[float]


class NowcastResponse(BaseModel):
    nowcast: float
    rSquared: float
    coefficients: List[float]


def linear_nowcast(req: NowcastRequest) -> NowcastResponse:
    y = np.asarray(req.targetHistory, dtype=float)
    X = np.asarray(req.indicatorHistory, dtype=float)
    current = np.asarray(req.currentIndicators, dtype=float)
    if X.ndim != 2 or X.shape[0] != len(y) or X.shape[1] != len(current):
        raise ValueError("Indicator history dimensions must align with target history/current indicators.")
    X1 = np.column_stack([np.ones(len(y)), X])
    beta, *_ = np.linalg.lstsq(X1, y, rcond=None)
    fitted = X1 @ beta
    sst = float(np.sum((y - y.mean()) ** 2))
    sse = float(np.sum((y - fitted) ** 2))
    r2 = 1 - sse / sst if sst > 0 else 0.0
    now = float(np.r_[1.0, current] @ beta)
    return NowcastResponse(nowcast=now, rSquared=r2, coefficients=list(map(float, beta)))


class RegimeForecastRequest(BaseModel):
    regimeProbabilities: List[float]
    regimeForecasts: List[List[float]]


class RegimeForecastResponse(BaseModel):
    probabilityWeightedForecast: List[float]
    betweenRegimeStd: List[float]


def regime_conditioned_forecast(req: RegimeForecastRequest) -> RegimeForecastResponse:
    p = np.asarray(req.regimeProbabilities, dtype=float)
    F = np.asarray(req.regimeForecasts, dtype=float)
    if F.ndim != 2 or F.shape[0] != len(p) or np.any(p < 0) or p.sum() <= 0:
        raise ValueError("Regime probabilities must align with forecast rows and have positive mass.")
    p /= p.sum()
    mean = p @ F
    variance = p @ ((F - mean) ** 2)
    return RegimeForecastResponse(probabilityWeightedForecast=list(map(float, mean)), betweenRegimeStd=list(map(float, np.sqrt(np.maximum(variance, 0.0)))))
