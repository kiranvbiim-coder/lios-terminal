"""Advanced macroeconomic signal, recession and transmission analytics for LiOS."""
from __future__ import annotations
from typing import Dict, List, Optional
import numpy as np
from pydantic import BaseModel, Field
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
import statsmodels.api as sm


class YieldCurveSignalRequest(BaseModel):
    maturitiesYears: List[float]
    yieldsPct: List[float]


class YieldCurveSignalResponse(BaseModel):
    levelPct: float
    slope10y2yPct: Optional[float]
    slope10y3mPct: Optional[float]
    curvaturePct: Optional[float]
    inversionDepthPct: float
    invertedPairs: int


def _interp_yield(mats, yields, t):
    if t < mats[0] or t > mats[-1]:
        return None
    return float(np.interp(t, mats, yields))


def yield_curve_signals(req: YieldCurveSignalRequest) -> YieldCurveSignalResponse:
    m = np.asarray(req.maturitiesYears, float); y = np.asarray(req.yieldsPct, float)
    if len(m) < 3 or y.shape != m.shape or np.any(np.diff(m) <= 0) or not np.all(np.isfinite(y)):
        raise ValueError("Yield curve requires >=3 sorted finite nodes.")
    y10, y2, y025, y5 = (_interp_yield(m, y, t) for t in [10, 2, .25, 5])
    dif = np.diff(y); inv = dif[dif < 0]
    return YieldCurveSignalResponse(levelPct=float(np.mean(y)), slope10y2yPct=None if y10 is None or y2 is None else y10 - y2,
                                    slope10y3mPct=None if y10 is None or y025 is None else y10 - y025,
                                    curvaturePct=None if y2 is None or y5 is None or y10 is None else 2 * y5 - y2 - y10,
                                    inversionDepthPct=float(-np.sum(inv)) if len(inv) else 0.0, invertedPairs=int(np.sum(dif < 0)))


class FCIRequest(BaseModel):
    indicatorNames: List[str]
    historicalValues: List[List[float]]
    tighteningDirection: List[int]
    latestValues: Optional[List[float]] = None


class FCIResponse(BaseModel):
    indexHistory: List[float]
    latestIndex: float
    componentLoadings: Dict[str, float]
    explainedVariancePct: float
    interpretation: str


def financial_conditions_index(req: FCIRequest) -> FCIResponse:
    names = req.indicatorNames; X = np.asarray(req.historicalValues, float)
    if X.ndim != 2 or X.shape[1] != len(names) or X.shape[0] < 30 or len(req.tighteningDirection) != len(names):
        raise ValueError("FCI historicalValues must be time x indicators with >=30 observations.")
    direction = np.asarray(req.tighteningDirection, float)
    if np.any(~np.isin(direction, [-1, 1])):
        raise ValueError("tighteningDirection entries must be -1 or +1.")
    scaler = StandardScaler(); Z = scaler.fit_transform(X) * direction
    pca = PCA(n_components=1); raw = pca.fit_transform(Z)[:, 0]; load = pca.components_[0].copy()
    if load.sum() < 0:
        raw = -raw; load = -load
    history = ((raw - raw.mean()) / raw.std(ddof=1)).astype(float)
    if req.latestValues is not None:
        lv = np.asarray(req.latestValues, float)
        if lv.shape != (len(names),):
            raise ValueError("latestValues must match indicators.")
        latest_raw = float((scaler.transform([lv])[0] * direction) @ load)
        latest = float((latest_raw - raw.mean()) / raw.std(ddof=1))
    else:
        latest = float(history[-1])
    interpretation = "tight" if latest > 1 else "easy" if latest < -1 else "neutral"
    return FCIResponse(indexHistory=history.tolist(), latestIndex=latest, componentLoadings=dict(zip(names, load.tolist())),
                       explainedVariancePct=float(pca.explained_variance_ratio_[0] * 100), interpretation=interpretation)


class RecessionModelRequest(BaseModel):
    featureNames: List[str]
    historicalFeatures: List[List[float]]
    recessionLabels: List[int]
    latestFeatures: List[float]
    l2PenaltyInverseC: float = Field(default=1.0, gt=0.0)


class RecessionModelResponse(BaseModel):
    probabilityPct: float
    coefficients: Dict[str, float]
    intercept: float
    trainingAccuracyPct: float


def recession_probability(req: RecessionModelRequest) -> RecessionModelResponse:
    X = np.asarray(req.historicalFeatures, float); y = np.asarray(req.recessionLabels, int); latest = np.asarray(req.latestFeatures, float)
    if X.ndim != 2 or X.shape[1] != len(req.featureNames) or X.shape[0] != len(y) or latest.shape != (X.shape[1],) or len(y) < 50:
        raise ValueError("Recession model dimensions invalid; >=50 observations required.")
    if set(np.unique(y)) - {0, 1} or len(np.unique(y)) < 2:
        raise ValueError("recessionLabels must contain both 0 and 1.")
    sc = StandardScaler(); Z = sc.fit_transform(X)
    model = LogisticRegression(C=req.l2PenaltyInverseC, max_iter=5000, class_weight="balanced").fit(Z, y)
    prob = float(model.predict_proba(sc.transform([latest]))[0, 1] * 100); acc = float(model.score(Z, y) * 100)
    coef = model.coef_[0] / sc.scale_; intercept = float(model.intercept_[0] - np.sum(model.coef_[0] * sc.mean_ / sc.scale_))
    return RecessionModelResponse(probabilityPct=prob, coefficients=dict(zip(req.featureNames, coef.tolist())), intercept=intercept, trainingAccuracyPct=acc)


class InflationComponent(BaseModel):
    name: str
    weightPct: float = Field(ge=0.0)
    inflationRatePct: float


class InflationDecompositionRequest(BaseModel):
    components: List[InflationComponent]


class InflationDecompositionResponse(BaseModel):
    headlineInflationPct: float
    contributionsPctPoints: Dict[str, float]
    contributionSharesPct: Dict[str, float]


def inflation_decomposition(req: InflationDecompositionRequest) -> InflationDecompositionResponse:
    if not req.components:
        raise ValueError("At least one inflation component required.")
    weights = np.array([c.weightPct for c in req.components], float)
    if abs(weights.sum() - 100) > 1e-4:
        raise ValueError("Inflation component weights must sum to 100.")
    cont = np.array([c.weightPct / 100 * c.inflationRatePct for c in req.components]); headline = float(cont.sum())
    shares = np.zeros_like(cont) if abs(headline) < 1e-12 else cont / headline * 100
    return InflationDecompositionResponse(headlineInflationPct=headline, contributionsPctPoints=dict(zip([c.name for c in req.components], cont.tolist())),
                                          contributionSharesPct=dict(zip([c.name for c in req.components], shares.tolist())))


class MacroTransmissionRequest(BaseModel):
    macroFactorNames: List[str]
    macroChanges: List[List[float]]
    companyMetricChange: List[float]
    scenarioMacroChanges: Dict[str, float]


class MacroTransmissionResponse(BaseModel):
    sensitivities: Dict[str, float]
    intercept: float
    rSquared: float
    scenarioCompanyMetricChange: float
    robustStandardErrors: Dict[str, float]


def macro_company_transmission(req: MacroTransmissionRequest) -> MacroTransmissionResponse:
    X = np.asarray(req.macroChanges, float); y = np.asarray(req.companyMetricChange, float)
    if X.ndim != 2 or X.shape[1] != len(req.macroFactorNames) or X.shape[0] != len(y) or len(y) < max(30, X.shape[1] * 5):
        raise ValueError("Macro transmission data dimensions invalid or history too short.")
    fit = sm.OLS(y, sm.add_constant(X)).fit(cov_type="HC3"); beta = np.asarray(fit.params[1:])
    scenario = np.array([req.scenarioMacroChanges.get(n, 0.0) for n in req.macroFactorNames]); pred = float(fit.params[0] + scenario @ beta)
    return MacroTransmissionResponse(sensitivities=dict(zip(req.macroFactorNames, beta.tolist())), intercept=float(fit.params[0]),
                                     rSquared=float(fit.rsquared), scenarioCompanyMetricChange=pred,
                                     robustStandardErrors=dict(zip(req.macroFactorNames, np.asarray(fit.bse[1:]).tolist())))


class FiscalMultiplierRequest(BaseModel):
    baselineGdp: float = Field(gt=0.0)
    fiscalImpulse: float
    multiplier: float
    importLeakagePct: float = Field(default=0.0, ge=0.0, le=100.0)
    crowdingOutPct: float = Field(default=0.0, ge=0.0, le=100.0)
    taxFeedbackPct: float = Field(default=0.0, ge=0.0, le=100.0)


class FiscalMultiplierResponse(BaseModel):
    grossGdpImpact: float
    netGdpImpact: float
    netGdpImpactPct: float
    effectiveMultiplier: float


def fiscal_multiplier(req: FiscalMultiplierRequest) -> FiscalMultiplierResponse:
    gross = req.fiscalImpulse * req.multiplier
    net = gross * (1 - req.importLeakagePct / 100) * (1 - req.crowdingOutPct / 100) * (1 - req.taxFeedbackPct / 100)
    eff = net / req.fiscalImpulse if abs(req.fiscalImpulse) > 1e-12 else 0
    return FiscalMultiplierResponse(grossGdpImpact=float(gross), netGdpImpact=float(net), netGdpImpactPct=float(net / req.baselineGdp * 100), effectiveMultiplier=float(eff))
