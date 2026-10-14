"""Advanced econometric diagnostics and causal-analysis helpers.

These routines quantify identification quality; they do not turn weak designs into
causal claims. Callers should persist design assumptions and pre-analysis choices.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np
from pydantic import BaseModel, Field
from scipy import optimize, stats
from sklearn.linear_model import LogisticRegression


def _ols(y: np.ndarray, X: np.ndarray):
    X1 = np.column_stack([np.ones(len(y)), X])
    beta, *_ = np.linalg.lstsq(X1, y, rcond=None)
    resid = y - X1 @ beta
    n, k = X1.shape
    sigma2 = float(resid @ resid / max(n - k, 1))
    cov = sigma2 * np.linalg.pinv(X1.T @ X1)
    se = np.sqrt(np.maximum(np.diag(cov), 0.0))
    return beta, se, resid


class WeakInstrumentRequest(BaseModel):
    endogenous: List[float]
    instruments: List[List[float]]
    exogenous: Optional[List[List[float]]] = None


class WeakInstrumentResponse(BaseModel):
    firstStageFStatistic: float
    firstStagePValue: float
    partialR2: float
    weakInstrumentWarning: bool


def weak_instrument_diagnostics(req: WeakInstrumentRequest) -> WeakInstrumentResponse:
    y = np.asarray(req.endogenous, dtype=float)
    Z = np.asarray(req.instruments, dtype=float).T
    X = np.asarray(req.exogenous, dtype=float).T if req.exogenous else np.empty((len(y), 0))
    if Z.ndim != 2 or Z.shape[0] != len(y) or X.shape[0] != len(y):
        raise ValueError("Instrument/exogenous observations must align with endogenous values.")
    full = np.column_stack([X, Z])
    beta_f, _, resid_f = _ols(y, full)
    _, _, resid_r = _ols(y, X if X.shape[1] else np.empty((len(y), 0)))
    sse_f, sse_r = float(resid_f @ resid_f), float(resid_r @ resid_r)
    q = Z.shape[1]
    df2 = max(len(y) - full.shape[1] - 1, 1)
    fstat = max(0.0, ((sse_r - sse_f) / max(q, 1)) / max(sse_f / df2, 1e-18))
    p = float(stats.f.sf(fstat, q, df2))
    partial_r2 = max(0.0, min(1.0, (sse_r - sse_f) / max(sse_r, 1e-18)))
    return WeakInstrumentResponse(firstStageFStatistic=fstat, firstStagePValue=p, partialR2=partial_r2, weakInstrumentWarning=fstat < 10.0)


class EventStudyRequest(BaseModel):
    assetReturnsPct: List[float]
    marketReturnsPct: List[float]
    eventIndex: int = Field(ge=0)
    estimationWindow: int = Field(default=120, ge=20)
    eventWindowBefore: int = Field(default=5, ge=0)
    eventWindowAfter: int = Field(default=5, ge=0)


class EventStudyResponse(BaseModel):
    alphaPct: float
    beta: float
    abnormalReturnsPct: List[float]
    cumulativeAbnormalReturnPct: float
    eventStartIndex: int
    eventEndIndex: int


def event_study(req: EventStudyRequest) -> EventStudyResponse:
    a = np.asarray(req.assetReturnsPct, dtype=float)
    m = np.asarray(req.marketReturnsPct, dtype=float)
    if a.shape != m.shape or req.eventIndex >= len(a):
        raise ValueError("Asset and market return series must align and include eventIndex.")
    est_end = req.eventIndex - req.eventWindowBefore
    est_start = est_end - req.estimationWindow
    if est_start < 0 or est_end - est_start < 20:
        raise ValueError("Insufficient pre-event observations for the estimation window.")
    beta, _, _ = _ols(a[est_start:est_end], m[est_start:est_end, None])
    start = max(0, req.eventIndex - req.eventWindowBefore)
    end = min(len(a) - 1, req.eventIndex + req.eventWindowAfter)
    expected = beta[0] + beta[1] * m[start:end + 1]
    abnormal = a[start:end + 1] - expected
    return EventStudyResponse(alphaPct=float(beta[0]), beta=float(beta[1]), abnormalReturnsPct=list(map(float, abnormal)), cumulativeAbnormalReturnPct=float(abnormal.sum()), eventStartIndex=start, eventEndIndex=end)


class SyntheticControlRequest(BaseModel):
    treatedPre: List[float]
    donorPre: List[List[float]]
    treatedPost: List[float]
    donorPost: List[List[float]]


class SyntheticControlResponse(BaseModel):
    donorWeights: List[float]
    preRmse: float
    treatmentEffects: List[float]
    averageTreatmentEffect: float


def synthetic_control(req: SyntheticControlRequest) -> SyntheticControlResponse:
    y_pre = np.asarray(req.treatedPre, dtype=float)
    X_pre = np.asarray(req.donorPre, dtype=float)
    y_post = np.asarray(req.treatedPost, dtype=float)
    X_post = np.asarray(req.donorPost, dtype=float)
    if X_pre.ndim != 2 or X_post.ndim != 2 or X_pre.shape[0] != len(y_pre) or X_post.shape[0] != len(y_post) or X_pre.shape[1] != X_post.shape[1]:
        raise ValueError("Donor matrices must align by time and donor count.")
    n_donors = X_pre.shape[1]
    res = optimize.minimize(lambda w: float(np.mean((y_pre - X_pre @ w) ** 2)), np.ones(n_donors) / n_donors, method="SLSQP", bounds=[(0.0, 1.0)] * n_donors, constraints=[{"type": "eq", "fun": lambda w: float(w.sum() - 1.0)}])
    if not res.success:
        raise ValueError(f"Synthetic-control fit failed: {res.message}")
    pre_resid = y_pre - X_pre @ res.x
    effect = y_post - X_post @ res.x
    return SyntheticControlResponse(donorWeights=list(map(float, res.x)), preRmse=float(np.sqrt(np.mean(pre_resid ** 2))), treatmentEffects=list(map(float, effect)), averageTreatmentEffect=float(effect.mean()))


class PropensityMatchRequest(BaseModel):
    treated: List[int]
    covariates: List[List[float]]
    outcome: List[float]
    caliper: float = Field(default=0.05, gt=0, le=1)


class PropensityMatchResponse(BaseModel):
    averageTreatmentEffectOnTreated: float
    matchedPairs: int
    unmatchedTreated: int
    meanPropensityTreated: float
    meanPropensityControl: float


def propensity_score_match(req: PropensityMatchRequest) -> PropensityMatchResponse:
    t = np.asarray(req.treated, dtype=int)
    X = np.asarray(req.covariates, dtype=float)
    y = np.asarray(req.outcome, dtype=float)
    if X.ndim != 2 or X.shape[0] != len(t) or y.shape != t.shape or set(np.unique(t)) - {0, 1}:
        raise ValueError("Treatment must be binary and all observations must align.")
    model = LogisticRegression(max_iter=2000, solver="lbfgs").fit(X, t)
    ps = model.predict_proba(X)[:, 1]
    treated_idx = np.where(t == 1)[0]
    control_idx = np.where(t == 0)[0].tolist()
    effects = []
    for i in treated_idx:
        if not control_idx:
            break
        distances = np.abs(ps[control_idx] - ps[i])
        jpos = int(np.argmin(distances))
        if distances[jpos] <= req.caliper:
            j = control_idx.pop(jpos)
            effects.append(float(y[i] - y[j]))
    if not effects:
        raise ValueError("No treated observations could be matched within the caliper.")
    return PropensityMatchResponse(averageTreatmentEffectOnTreated=float(np.mean(effects)), matchedPairs=len(effects), unmatchedTreated=len(treated_idx) - len(effects), meanPropensityTreated=float(ps[t == 1].mean()), meanPropensityControl=float(ps[t == 0].mean()))


class LocalProjectionRequest(BaseModel):
    response: List[float]
    shock: List[float]
    controls: Optional[List[List[float]]] = None
    horizons: int = Field(default=12, ge=1, le=60)
    lags: int = Field(default=1, ge=0, le=12)


class LocalProjectionResponse(BaseModel):
    impulseResponse: List[float]
    standardErrors: List[float]
    ci95Low: List[float]
    ci95High: List[float]


def local_projections(req: LocalProjectionRequest) -> LocalProjectionResponse:
    y = np.asarray(req.response, dtype=float)
    shock = np.asarray(req.shock, dtype=float)
    controls = np.asarray(req.controls, dtype=float).T if req.controls else np.empty((len(y), 0))
    if y.shape != shock.shape or controls.shape[0] != len(y):
        raise ValueError("Response, shock and controls must align.")
    irf, se_out = [], []
    max_h = req.horizons
    for h in range(max_h + 1):
        start = req.lags
        end = len(y) - h
        if end - start < 20:
            raise ValueError("Insufficient observations for requested local-projection horizons/lags.")
        rows = []
        for t in range(start, end):
            row = [shock[t]]
            row.extend(controls[t].tolist())
            for lag in range(1, req.lags + 1):
                row.extend([y[t - lag], shock[t - lag]])
            rows.append(row)
        target = y[start + h:end + h]
        beta, se, _ = _ols(target, np.asarray(rows, dtype=float))
        irf.append(float(beta[1]))
        se_out.append(float(se[1]))
    low = [b - 1.96 * s for b, s in zip(irf, se_out)]
    high = [b + 1.96 * s for b, s in zip(irf, se_out)]
    return LocalProjectionResponse(impulseResponse=irf, standardErrors=se_out, ci95Low=low, ci95High=high)


class BayesianVarRequest(BaseModel):
    seriesNames: List[str]
    data: List[List[float]]
    lags: int = Field(default=1, ge=1, le=12)
    ridgePrior: float = Field(default=1.0, gt=0)
    forecastSteps: int = Field(default=8, ge=1, le=60)


class BayesianVarResponse(BaseModel):
    coefficientMatrix: List[List[float]]
    forecasts: Dict[str, List[float]]
    residualCovariance: List[List[float]]


def bayesian_var(req: BayesianVarRequest) -> BayesianVarResponse:
    Yraw = np.asarray(req.data, dtype=float).T
    if Yraw.ndim != 2 or Yraw.shape[1] != len(req.seriesNames):
        raise ValueError("data must provide one series per seriesNames entry.")
    T, k = Yraw.shape
    if T <= req.lags + k + 2:
        raise ValueError("Insufficient observations for requested Bayesian VAR.")
    X, Y = [], []
    for t in range(req.lags, T):
        row = [1.0]
        for lag in range(1, req.lags + 1):
            row.extend(Yraw[t - lag].tolist())
        X.append(row); Y.append(Yraw[t])
    X = np.asarray(X); Y = np.asarray(Y)
    penalty = np.eye(X.shape[1]) * req.ridgePrior
    penalty[0, 0] = 0.0
    B = np.linalg.solve(X.T @ X + penalty, X.T @ Y)
    resid = Y - X @ B
    sigma = np.cov(resid, rowvar=False)
    history = [row.copy() for row in Yraw]
    forecasts = {name: [] for name in req.seriesNames}
    for _ in range(req.forecastSteps):
        row = [1.0]
        for lag in range(1, req.lags + 1):
            row.extend(history[-lag].tolist())
        pred = np.asarray(row) @ B
        history.append(pred)
        for j, name in enumerate(req.seriesNames): forecasts[name].append(float(pred[j]))
    return BayesianVarResponse(coefficientMatrix=B.tolist(), forecasts=forecasts, residualCovariance=np.asarray(sigma).tolist())
