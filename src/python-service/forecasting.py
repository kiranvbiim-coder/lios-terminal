"""
Forecasting upgrade (LIMURIA_ENGINES port plan Phase 4).

The module exposes production forecasting engines and, for SARIMAX, an optional
rolling-origin validation mode. A model is not decision-grade merely because
its in-sample AIC/BIC is attractive; callers can request a leakage-safe
out-of-sample comparison against naive, drift, or seasonal-naive benchmarks.
"""

from typing import List, Literal, Optional

import numpy as np
from pydantic import BaseModel, Field

from forecast_validation import (
    SarimaxBacktestRequest,
    SarimaxBacktestResponse,
    sarimax_rolling_backtest,
)


# ─── SARIMAX ────────────────────────────────────────────────────────────────
class SarimaxRequest(BaseModel):
    series: List[float] = Field(min_length=20, max_length=5000)
    order: List[int] = Field(default=[1, 1, 1], min_length=3, max_length=3)
    seasonalOrder: Optional[List[int]] = None
    exog: Optional[List[List[float]]] = None
    exogForecast: Optional[List[List[float]]] = None
    horizon: int = Field(default=12, ge=1, le=365)
    confidenceLevel: float = Field(default=0.95, gt=0.5, lt=1)

    # Institutional validation is opt-in for backward compatibility with the
    # historical forecasting endpoint. Decision-grade workflows should set
    # validationMode="rolling_oos" and attach the returned validation artifact
    # to the model-assurance evidence chain.
    validationMode: Literal["none", "rolling_oos"] = "none"
    validationInitialTrainSize: Optional[int] = Field(default=None, ge=20)
    validationHorizon: int = Field(default=1, ge=1, le=24)
    validationStep: int = Field(default=1, ge=1, le=24)
    validationMaxOrigins: int = Field(default=20, ge=3, le=100)
    validationBenchmark: Literal["naive", "seasonal_naive", "drift"] = "naive"
    validationSeasonalPeriod: Optional[int] = Field(default=None, ge=2, le=366)
    validationMinimumSkillPct: float = Field(default=0.0, ge=-100.0, le=100.0)
    validationMinimumWinRate: float = Field(default=0.5, ge=0.0, le=1.0)


class SarimaxResponse(BaseModel):
    forecast: List[float]
    lowerCI: List[float]
    upperCI: List[float]
    fittedValues: List[float]
    aic: float
    bic: float
    logLikelihood: float
    paramNames: List[str]
    paramValues: List[float]
    validation: Optional[SarimaxBacktestResponse] = None


def sarimax_forecast(req: SarimaxRequest) -> SarimaxResponse:
    from statsmodels.tsa.statespace.sarimax import SARIMAX

    p, d, q = req.order
    seasonal_order = tuple(req.seasonalOrder) if req.seasonalOrder else (0, 0, 0, 0)
    if len(seasonal_order) != 4:
        raise ValueError("seasonalOrder must be [P, D, Q, s]")

    series = np.asarray(req.series, dtype=float)
    if not np.all(np.isfinite(series)):
        raise ValueError("series contains NaN or infinite values")

    exog = np.array(req.exog, dtype=float) if req.exog is not None else None
    if exog is not None and len(exog) != len(req.series):
        raise ValueError(f"exog has {len(exog)} rows but series has {len(req.series)} observations")
    if exog is not None and not np.all(np.isfinite(exog)):
        raise ValueError("exog contains NaN or infinite values")
    if exog is not None and req.exogForecast is None:
        raise ValueError("exogForecast is required when exog is supplied (needed to forecast forward)")
    exog_forecast = np.array(req.exogForecast, dtype=float) if req.exogForecast is not None else None
    if exog_forecast is not None and len(exog_forecast) != req.horizon:
        raise ValueError(f"exogForecast has {len(exog_forecast)} rows but horizon is {req.horizon}")
    if exog_forecast is not None and not np.all(np.isfinite(exog_forecast)):
        raise ValueError("exogForecast contains NaN or infinite values")

    model = SARIMAX(
        series,
        exog=exog,
        order=(p, d, q),
        seasonal_order=seasonal_order,
        enforce_stationarity=False,
        enforce_invertibility=False,
    )
    res = model.fit(disp=False)

    fc = res.get_forecast(steps=req.horizon, exog=exog_forecast)
    mean_fc = fc.predicted_mean
    ci = np.asarray(fc.conf_int(alpha=1 - req.confidenceLevel), dtype=float)
    forecast_values = np.asarray(mean_fc, dtype=float)
    fitted_values = np.asarray(res.fittedvalues, dtype=float)
    if not np.all(np.isfinite(forecast_values)) or not np.all(np.isfinite(ci)):
        raise ValueError("SARIMAX produced NaN or infinite forecast outputs")

    validation = None
    if req.validationMode == "rolling_oos":
        if exog is not None:
            raise ValueError(
                "rolling_oos validation for SARIMAX with exogenous regressors is not yet supported; "
                "use validationMode='none' for exploratory exogenous forecasts or validate through an approved external harness"
            )
        validation = sarimax_rolling_backtest(SarimaxBacktestRequest(
            series=req.series,
            order=req.order,
            seasonalOrder=req.seasonalOrder,
            initialTrainSize=req.validationInitialTrainSize,
            horizon=req.validationHorizon,
            step=req.validationStep,
            maxOrigins=req.validationMaxOrigins,
            benchmark=req.validationBenchmark,
            seasonalPeriod=req.validationSeasonalPeriod,
            confidenceLevel=req.confidenceLevel,
            minimumSkillPct=req.validationMinimumSkillPct,
            minimumWinRate=req.validationMinimumWinRate,
        ))

    return SarimaxResponse(
        forecast=forecast_values.tolist(),
        lowerCI=ci[:, 0].tolist(),
        upperCI=ci[:, 1].tolist(),
        fittedValues=fitted_values.tolist(),
        aic=float(res.aic),
        bic=float(res.bic),
        logLikelihood=float(res.llf),
        paramNames=list(res.param_names),
        paramValues=[float(v) for v in res.params],
        validation=validation,
    )


# ─── STL trend/seasonal decomposition ─────────────────────────────────────
class StlRequest(BaseModel):
    series: List[float] = Field(min_length=20, max_length=5000)
    period: int = Field(ge=2, le=366)
    robust: bool = True


class StlResponse(BaseModel):
    trend: List[float]
    seasonal: List[float]
    resid: List[float]
    trendStrength: float
    seasonalStrength: float


def stl_decompose(req: StlRequest) -> StlResponse:
    from statsmodels.tsa.seasonal import STL

    if len(req.series) < 2 * req.period:
        raise ValueError(f"Need at least 2 full periods ({2 * req.period} points) to decompose at period={req.period}, got {len(req.series)}")

    x = np.asarray(req.series, dtype=float)
    if not np.all(np.isfinite(x)):
        raise ValueError("series contains NaN or infinite values")
    res = STL(x, period=req.period, robust=req.robust).fit()
    resid_var = float(np.var(res.resid))
    trend_denom = float(np.var(res.trend + res.resid))
    seasonal_denom = float(np.var(res.seasonal + res.resid))
    trend_strength = max(0.0, 1 - resid_var / trend_denom) if trend_denom > 0 else 0.0
    seasonal_strength = max(0.0, 1 - resid_var / seasonal_denom) if seasonal_denom > 0 else 0.0

    return StlResponse(
        trend=res.trend.tolist(), seasonal=res.seasonal.tolist(), resid=res.resid.tolist(),
        trendStrength=trend_strength, seasonalStrength=seasonal_strength,
    )


# ─── Changepoint detection: real bootstrap CUSUM, or real PELT ───────────
class ChangepointRequest(BaseModel):
    series: List[float] = Field(min_length=20, max_length=5000)
    method: Literal["cusum", "pelt"] = "pelt"
    bootstrapIterations: int = Field(default=1000, ge=200, le=5000)
    confidenceThreshold: float = Field(default=0.95, gt=0.5, lt=1)
    minSegmentLength: int = Field(default=10, ge=3)
    penalty: Optional[float] = None


class ChangepointHit(BaseModel):
    index: int
    confidence: Optional[float] = None
    meanBefore: float
    meanAfter: float


class ChangepointResponse(BaseModel):
    method: str
    changepoints: List[ChangepointHit]


def _cusum_single(x: np.ndarray, n_boot: int, seed: int = 0) -> tuple[int, float]:
    """Taylor (2000)-style CUSUM change-point analysis."""
    rng = np.random.default_rng(seed)
    mean_x = x.mean()
    S = np.cumsum(x - mean_x)
    s_range = S.max() - S.min()
    cp_idx = int(np.argmax(np.abs(S)))
    count_less = 0
    for _ in range(n_boot):
        xb = rng.permutation(x)
        Sb = np.cumsum(xb - mean_x)
        if (Sb.max() - Sb.min()) < s_range:
            count_less += 1
    return cp_idx, count_less / n_boot


def _cusum_recursive(x: np.ndarray, offset: int, req: ChangepointRequest, out: List[ChangepointHit], seed: int, depth: int = 0) -> None:
    if len(x) < 2 * req.minSegmentLength:
        return
    cp_idx, confidence = _cusum_single(x, req.bootstrapIterations, seed=seed)
    required = 1 - (1 - req.confidenceThreshold) / (2 ** depth)
    if confidence < required:
        return
    if cp_idx < req.minSegmentLength or (len(x) - cp_idx) < req.minSegmentLength:
        return
    out.append(ChangepointHit(
        index=offset + cp_idx, confidence=confidence,
        meanBefore=float(x[:cp_idx + 1].mean()), meanAfter=float(x[cp_idx + 1:].mean()),
    ))
    _cusum_recursive(x[:cp_idx + 1], offset, req, out, seed + 1, depth + 1)
    _cusum_recursive(x[cp_idx + 1:], offset + cp_idx + 1, req, out, seed + 2, depth + 1)


def changepoint_detect(req: ChangepointRequest) -> ChangepointResponse:
    x = np.array(req.series, dtype=float)
    if not np.all(np.isfinite(x)):
        raise ValueError("series contains NaN or infinite values")

    if req.method == "cusum":
        hits: List[ChangepointHit] = []
        _cusum_recursive(x, 0, req, hits, seed=0)
        hits.sort(key=lambda h: h.index)
        return ChangepointResponse(method="cusum", changepoints=hits)

    import ruptures as rpt

    penalty = req.penalty if req.penalty is not None else 3 * np.log(len(x)) * np.var(x)
    algo = rpt.Pelt(model="l2", min_size=req.minSegmentLength).fit(x.reshape(-1, 1))
    breaks = [b for b in algo.predict(pen=penalty) if b < len(x)]
    hits = []
    prev = 0
    for index, b in enumerate(breaks):
        nxt = breaks[index + 1] if index + 1 < len(breaks) else len(x)
        hits.append(ChangepointHit(
            index=b, confidence=None,
            meanBefore=float(x[prev:b].mean()), meanAfter=float(x[b:nxt].mean()),
        ))
        prev = b
    return ChangepointResponse(method="pelt", changepoints=hits)


# ─── GARCH via `arch` -- benchmark model alongside the existing TS GARCH ──
class GarchRequest(BaseModel):
    returnsPct: List[float] = Field(min_length=50, max_length=10000)
    p: int = Field(default=1, ge=1, le=5)
    q: int = Field(default=1, ge=1, le=5)
    vol: Literal["GARCH", "EGARCH"] = "GARCH"
    dist: Literal["normal", "t", "skewt"] = "normal"


class GarchResponse(BaseModel):
    vol: str
    dist: str
    mu: float
    omega: float
    alpha: List[float]
    beta: List[float]
    gamma: Optional[List[float]] = None
    nu: Optional[float] = None
    conditionalVolatilityPct: List[float]
    persistence: float
    logLikelihood: float
    aic: float
    bic: float


def garch_fit(req: GarchRequest) -> GarchResponse:
    from arch import arch_model

    x = np.asarray(req.returnsPct, dtype=float)
    if not np.all(np.isfinite(x)):
        raise ValueError("returnsPct contains NaN or infinite values")
    dist_map = {"normal": "normal", "t": "t", "skewt": "skewt"}
    kwargs = dict(mean="Constant", vol=req.vol, p=req.p, q=req.q, dist=dist_map[req.dist])
    if req.vol == "EGARCH":
        kwargs["o"] = req.p
    am = arch_model(x, **kwargs)
    res = am.fit(disp="off")

    params = res.params
    alpha = [float(params[f"alpha[{i}]"]) for i in range(1, req.p + 1)]
    beta = [float(params[f"beta[{i}]"]) for i in range(1, req.q + 1)]
    gamma = [float(params[f"gamma[{i}]"]) for i in range(1, req.p + 1)] if req.vol == "EGARCH" else None
    nu = float(params["nu"]) if "nu" in params.index else None

    return GarchResponse(
        vol=req.vol, dist=req.dist, mu=float(params["mu"]), omega=float(params["omega"]),
        alpha=alpha, beta=beta, gamma=gamma, nu=nu,
        conditionalVolatilityPct=res.conditional_volatility.tolist(),
        persistence=float(sum(alpha) + sum(beta)),
        logLikelihood=float(res.loglikelihood), aic=float(res.aic), bic=float(res.bic),
    )
