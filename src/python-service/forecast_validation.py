"""Institutional forecast validation for LiOS.

A fitted model is not considered decision-grade merely because its in-sample
AIC/BIC is attractive.  This module performs rolling-origin, strictly
out-of-sample evaluation against simple benchmarks and reports finite,
interpretable accuracy/coverage diagnostics.
"""

from __future__ import annotations

import math
import warnings
from typing import List, Literal, Optional

import numpy as np
from pydantic import BaseModel, Field
from statsmodels.tools.sm_exceptions import ConvergenceWarning
from statsmodels.tsa.statespace.sarimax import SARIMAX


BenchmarkKind = Literal["naive", "seasonal_naive", "drift"]


class SarimaxBacktestRequest(BaseModel):
    series: List[float] = Field(min_length=40, max_length=5000)
    order: List[int] = Field(default=[1, 1, 1], min_length=3, max_length=3)
    seasonalOrder: Optional[List[int]] = None
    initialTrainSize: Optional[int] = Field(default=None, ge=20)
    horizon: int = Field(default=1, ge=1, le=24)
    step: int = Field(default=1, ge=1, le=24)
    maxOrigins: int = Field(default=20, ge=3, le=100)
    benchmark: BenchmarkKind = "naive"
    seasonalPeriod: Optional[int] = Field(default=None, ge=2, le=366)
    confidenceLevel: float = Field(default=0.95, gt=0.5, lt=1.0)
    minimumSkillPct: float = Field(default=0.0, ge=-100.0, le=100.0)
    minimumWinRate: float = Field(default=0.5, ge=0.0, le=1.0)


class ForecastMetrics(BaseModel):
    mae: float
    rmse: float
    smapePct: float
    mase: float
    bias: float


class ForecastFold(BaseModel):
    origin: int
    trainStart: int
    trainEndExclusive: int
    testStart: int
    testEndExclusive: int
    actual: List[float]
    forecast: List[float]
    benchmarkForecast: List[float]
    lowerCI: List[float]
    upperCI: List[float]
    modelRmse: float
    benchmarkRmse: float
    converged: bool


class SarimaxBacktestResponse(BaseModel):
    modelMetrics: ForecastMetrics
    benchmarkMetrics: ForecastMetrics
    skillRmsePct: float
    foldWinRate: float
    intervalCoverage: float
    nominalCoverage: float
    coverageGap: float
    originsEvaluated: int
    lookaheadSafe: bool
    decisionGradeEligible: bool
    blockers: List[str]
    warnings: List[str]
    folds: List[ForecastFold]


def _validate_numeric_series(series: List[float]) -> np.ndarray:
    x = np.asarray(series, dtype=float)
    if x.ndim != 1 or x.size == 0:
        raise ValueError("series must be a non-empty one-dimensional sequence")
    if not np.all(np.isfinite(x)):
        raise ValueError("series contains NaN or infinite values")
    return x


def _validate_orders(order: List[int], seasonal_order: Optional[List[int]]) -> tuple[tuple[int, int, int], tuple[int, int, int, int]]:
    if len(order) != 3 or any((not isinstance(v, int) or v < 0 or v > 5) for v in order):
        raise ValueError("order must be [p,d,q] with integer terms between 0 and 5")
    seasonal = seasonal_order or [0, 0, 0, 0]
    if len(seasonal) != 4:
        raise ValueError("seasonalOrder must be [P,D,Q,s]")
    p, d, q, period = seasonal
    if any((not isinstance(v, int) or v < 0) for v in seasonal):
        raise ValueError("seasonalOrder values must be non-negative integers")
    if any(v > 5 for v in (p, d, q)):
        raise ValueError("seasonal AR/I/MA terms must be <= 5")
    if period not in (0, 1) and period < 2:
        raise ValueError("seasonal period must be 0 (disabled) or >= 2")
    if period > 366:
        raise ValueError("seasonal period must be <= 366")
    if period in (0, 1) and any(v > 0 for v in (p, d, q)):
        raise ValueError("seasonal period must be >= 2 when seasonal terms are enabled")
    return tuple(order), tuple(seasonal)


def _benchmark_forecast(train: np.ndarray, horizon: int, kind: BenchmarkKind, seasonal_period: Optional[int]) -> np.ndarray:
    if kind == "naive":
        return np.repeat(train[-1], horizon)
    if kind == "drift":
        slope = (train[-1] - train[0]) / max(1, len(train) - 1)
        return np.asarray([train[-1] + slope * (i + 1) for i in range(horizon)], dtype=float)
    if not seasonal_period or seasonal_period < 2:
        raise ValueError("seasonalPeriod >= 2 is required for seasonal_naive benchmark")
    if len(train) < seasonal_period:
        raise ValueError("training window is shorter than seasonalPeriod")
    return np.asarray([train[-seasonal_period + (i % seasonal_period)] for i in range(horizon)], dtype=float)


def _mase_scale(train: np.ndarray, benchmark: BenchmarkKind, seasonal_period: Optional[int]) -> float:
    lag = seasonal_period if benchmark == "seasonal_naive" and seasonal_period else 1
    if len(train) <= lag:
        return math.nan
    scale = float(np.mean(np.abs(train[lag:] - train[:-lag])))
    return scale if scale > np.finfo(float).eps else math.nan


def _aggregate_metrics(actual: np.ndarray, predicted: np.ndarray, absolute_scaled_errors: np.ndarray) -> ForecastMetrics:
    errors = predicted - actual
    abs_errors = np.abs(errors)
    mae = float(np.mean(abs_errors))
    rmse = float(np.sqrt(np.mean(errors**2)))
    denominator = (np.abs(actual) + np.abs(predicted)) / 2.0
    smape_terms = np.divide(abs_errors, denominator, out=np.zeros_like(abs_errors), where=denominator > np.finfo(float).eps)
    smape = float(100.0 * np.mean(smape_terms))
    finite_scaled = absolute_scaled_errors[np.isfinite(absolute_scaled_errors)]
    mase = float(np.mean(finite_scaled)) if finite_scaled.size else math.nan
    bias = float(np.mean(errors))
    return ForecastMetrics(mae=mae, rmse=rmse, smapePct=smape, mase=mase, bias=bias)


def _finite_metrics(metrics: ForecastMetrics) -> bool:
    return all(math.isfinite(value) for value in (metrics.mae, metrics.rmse, metrics.smapePct, metrics.mase, metrics.bias))


def _origin_indices(n: int, initial_train: int, horizon: int, step: int, max_origins: int) -> List[int]:
    available = list(range(initial_train, n - horizon + 1, step))
    if len(available) > max_origins:
        # Keep the most recent origins, which are usually more relevant while
        # retaining strict time ordering and a deterministic bounded runtime.
        available = available[-max_origins:]
    return available


def sarimax_rolling_backtest(req: SarimaxBacktestRequest) -> SarimaxBacktestResponse:
    x = _validate_numeric_series(req.series)
    order, seasonal_order = _validate_orders(req.order, req.seasonalOrder)
    seasonal_period = req.seasonalPeriod
    if req.benchmark == "seasonal_naive" and not seasonal_period:
        seasonal_period = seasonal_order[3] if seasonal_order[3] >= 2 else None
    if req.benchmark == "seasonal_naive" and not seasonal_period:
        raise ValueError("seasonalPeriod is required for seasonal_naive benchmark")

    default_train = max(20, int(math.ceil(len(x) * 0.60)))
    if seasonal_order[3] >= 2:
        default_train = max(default_train, 2 * seasonal_order[3])
    if seasonal_period:
        default_train = max(default_train, 2 * seasonal_period)
    initial_train = req.initialTrainSize or default_train
    if initial_train >= len(x):
        raise ValueError("initialTrainSize must leave at least one out-of-sample observation")
    if initial_train + req.horizon > len(x):
        raise ValueError("initialTrainSize + horizon exceeds available observations")

    origins = _origin_indices(len(x), initial_train, req.horizon, req.step, req.maxOrigins)
    if len(origins) < 3:
        raise ValueError("Need at least 3 rolling-origin folds for forecast validation")

    folds: List[ForecastFold] = []
    all_actual: List[float] = []
    all_model: List[float] = []
    all_benchmark: List[float] = []
    model_scaled: List[float] = []
    benchmark_scaled: List[float] = []
    covered = 0
    total_interval_points = 0
    convergence_failures = 0

    for origin in origins:
        train = x[:origin]
        actual = x[origin : origin + req.horizon]
        baseline = _benchmark_forecast(train, req.horizon, req.benchmark, seasonal_period)
        scale = _mase_scale(train, req.benchmark, seasonal_period)

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            model = SARIMAX(
                train,
                order=order,
                seasonal_order=seasonal_order,
                enforce_stationarity=False,
                enforce_invertibility=False,
            )
            fitted = model.fit(disp=False, maxiter=200)
            forecast_obj = fitted.get_forecast(steps=req.horizon)
            forecast = np.asarray(forecast_obj.predicted_mean, dtype=float)
            ci = np.asarray(forecast_obj.conf_int(alpha=1 - req.confidenceLevel), dtype=float)
            converged = bool(getattr(fitted, "mle_retvals", {}).get("converged", True)) and not any(
                issubclass(item.category, ConvergenceWarning) for item in caught
            )

        if forecast.shape != actual.shape or ci.shape != (req.horizon, 2):
            raise ValueError("SARIMAX returned an unexpected forecast shape")
        if not np.all(np.isfinite(forecast)) or not np.all(np.isfinite(ci)):
            raise ValueError("SARIMAX produced NaN or infinite out-of-sample outputs")
        if not converged:
            convergence_failures += 1

        lower = ci[:, 0]
        upper = ci[:, 1]
        covered += int(np.sum((actual >= lower) & (actual <= upper)))
        total_interval_points += len(actual)
        model_rmse = float(np.sqrt(np.mean((forecast - actual) ** 2)))
        benchmark_rmse = float(np.sqrt(np.mean((baseline - actual) ** 2)))

        folds.append(ForecastFold(
            origin=origin,
            trainStart=0,
            trainEndExclusive=origin,
            testStart=origin,
            testEndExclusive=origin + req.horizon,
            actual=actual.tolist(),
            forecast=forecast.tolist(),
            benchmarkForecast=baseline.tolist(),
            lowerCI=lower.tolist(),
            upperCI=upper.tolist(),
            modelRmse=model_rmse,
            benchmarkRmse=benchmark_rmse,
            converged=converged,
        ))

        all_actual.extend(actual.tolist())
        all_model.extend(forecast.tolist())
        all_benchmark.extend(baseline.tolist())
        if math.isfinite(scale) and scale > 0:
            model_scaled.extend((np.abs(forecast - actual) / scale).tolist())
            benchmark_scaled.extend((np.abs(baseline - actual) / scale).tolist())
        else:
            model_scaled.extend([math.nan] * len(actual))
            benchmark_scaled.extend([math.nan] * len(actual))

    actual_arr = np.asarray(all_actual, dtype=float)
    model_arr = np.asarray(all_model, dtype=float)
    benchmark_arr = np.asarray(all_benchmark, dtype=float)
    model_metrics = _aggregate_metrics(actual_arr, model_arr, np.asarray(model_scaled, dtype=float))
    benchmark_metrics = _aggregate_metrics(actual_arr, benchmark_arr, np.asarray(benchmark_scaled, dtype=float))

    eps = np.finfo(float).eps
    if benchmark_metrics.rmse <= eps:
        skill_rmse_pct = 0.0 if model_metrics.rmse <= eps else -100.0
    else:
        skill_rmse_pct = float(100.0 * (1.0 - model_metrics.rmse / benchmark_metrics.rmse))
    win_rate = float(np.mean([fold.modelRmse < fold.benchmarkRmse for fold in folds]))
    interval_coverage = covered / max(1, total_interval_points)
    coverage_gap = interval_coverage - req.confidenceLevel

    blockers: List[str] = []
    validation_warnings: List[str] = []
    if not _finite_metrics(model_metrics) or not _finite_metrics(benchmark_metrics):
        blockers.append("Forecast metrics are non-finite; MASE requires variation in the training history")
    if convergence_failures > 0:
        blockers.append(f"SARIMAX failed convergence diagnostics in {convergence_failures}/{len(folds)} folds")
    if skill_rmse_pct < req.minimumSkillPct:
        blockers.append(
            f"Out-of-sample RMSE skill {skill_rmse_pct:.2f}% is below required {req.minimumSkillPct:.2f}% versus {req.benchmark}"
        )
    if win_rate < req.minimumWinRate:
        blockers.append(
            f"Model wins only {100 * win_rate:.1f}% of folds; minimum is {100 * req.minimumWinRate:.1f}%"
        )

    # Coverage is sampled and can be noisy in short backtests.  A large miss is
    # a blocker; a smaller miss is retained as a warning rather than hidden.
    severe_coverage_floor = max(0.0, req.confidenceLevel - 0.20)
    review_coverage_floor = max(0.0, req.confidenceLevel - 0.10)
    if interval_coverage < severe_coverage_floor:
        blockers.append(
            f"Forecast interval coverage {interval_coverage:.3f} is far below nominal {req.confidenceLevel:.3f}"
        )
    elif interval_coverage < review_coverage_floor:
        validation_warnings.append(
            f"Forecast interval coverage {interval_coverage:.3f} is below nominal {req.confidenceLevel:.3f}"
        )

    lookahead_safe = all(fold.trainEndExclusive <= fold.testStart for fold in folds)
    if not lookahead_safe:
        blockers.append("Rolling-origin split contains lookahead leakage")

    return SarimaxBacktestResponse(
        modelMetrics=model_metrics,
        benchmarkMetrics=benchmark_metrics,
        skillRmsePct=skill_rmse_pct,
        foldWinRate=win_rate,
        intervalCoverage=interval_coverage,
        nominalCoverage=req.confidenceLevel,
        coverageGap=coverage_gap,
        originsEvaluated=len(folds),
        lookaheadSafe=lookahead_safe,
        decisionGradeEligible=len(blockers) == 0,
        blockers=blockers,
        warnings=validation_warnings,
        folds=folds,
    )
