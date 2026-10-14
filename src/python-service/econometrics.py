"""
Econometrics (LIMURIA_ENGINES port plan Phase 2b) -- panel data estimators,
instrumental variables, and multivariate time-series methods, all via real
statsmodels/linearmodels. Genuinely hard to reproduce correctly by hand:
linearmodels' panel estimators (Fixed/Random effects, proper clustered
variance), the Hausman specification test, VAR/VECM/Johansen's underlying
linear algebra, and Dickey-Fuller/KPSS's non-standard critical value
distributions. MixedLM supplies hierarchical random intercept/slope models.
Dynamic-panel Arellano-Bond/GMM is intentionally not exposed: linearmodels
7.0 has no Arellano-Bond estimator and no validated dynamic-panel package is
a dependency, so no hand-rolled substitute is allowed. Ported from
LIMURIA_ENGINES' engines/03_econometrics.py, verified real there. One item
explicitly NOT ported: the source's own `structural_break_tests()` (Chow/CUSUM)
just returns a note saying it's unimplemented -- honest, not fabricated, but
nothing to port.
"""

from typing import List, Literal, Optional

import numpy as np
import pandas as pd
from pydantic import BaseModel


# ─── Panel data: Pooled/Fixed/Random effects + Hausman ───────────────────
class PanelOlsRequest(BaseModel):
    y: List[float]
    x: List[List[float]]  # one list per predictor column
    entityIds: List[str]
    timeIds: List[str]
    covType: Literal["unadjusted", "robust", "clustered", "kernel"] = "unadjusted"
    clusterVar: Optional[List[str]] = None
    kernelMaxLags: Optional[int] = None

class PanelCoefficients(BaseModel):
    coefficients: List[float]  # [intercept/const, beta_1, beta_2, ...]
    standardErrors: List[float]
    tStats: List[float]
    pValues: List[float]
    rSquared: float


class PanelOlsResponse(BaseModel):
    pooledOls: PanelCoefficients
    fixedEffects: PanelCoefficients
    randomEffects: PanelCoefficients
    hausmanStatistic: float
    hausmanPValue: float
    hausmanDof: int
    hausmanConclusion: str  # plain-language read of the test


def panel_ols(req: PanelOlsRequest) -> PanelOlsResponse:
    from linearmodels import PanelOLS, PooledOLS, RandomEffects
    from scipy import stats as sstats

    n = len(req.y)
    # linearmodels requires the time index to be numeric or date-like, not
    # an arbitrary string label -- try real calendar dates first (the
    # common real case: quarterly/annual fiscal periods, trading dates),
    # falling back to a rank-encoding of the string labels in their own
    # sorted order (works for "2024Q1"/"2024Q2"-style labels too, which
    # sort correctly as strings) so any consistent label scheme still
    # produces a valid, correctly-ordered panel index.
    try:
        time_index = pd.to_datetime(req.timeIds, format="ISO8601")
    except (ValueError, TypeError):
        time_index = pd.factorize(pd.Series(req.timeIds), sort=True)[0]
    data = pd.DataFrame({"y": req.y, "entity": req.entityIds, "time": time_index})
    for i, col in enumerate(req.x):
        data[f"x{i}"] = col
    data = data.set_index(["entity", "time"])
    x_cols = [f"x{i}" for i in range(len(req.x))]
    exog = pd.concat([pd.Series(1.0, index=data.index, name="const"), data[x_cols]], axis=1)

    def _to_coef(res) -> PanelCoefficients:
        return PanelCoefficients(
            coefficients=res.params.tolist(),
            standardErrors=res.std_errors.tolist(),
            tStats=res.tstats.tolist(),
            pValues=res.pvalues.tolist(),
            rSquared=float(res.rsquared),
        )

    def _cov_kwargs(cov_type: str) -> dict:
        if cov_type == "unadjusted":
            return {"cov_type": "unadjusted"}
        if cov_type == "robust":
            return {"cov_type": "robust"}
        if cov_type == "clustered":
            labels = req.clusterVar if req.clusterVar else req.entityIds
            return {"cov_type": "clustered", "clusters": pd.Series(labels, index=data.index, name="cluster")}
        if cov_type == "kernel":
            kwargs = {"cov_type": "kernel"}
            if req.kernelMaxLags is not None:
                kwargs["bandwidth"] = req.kernelMaxLags
            return kwargs
        raise ValueError(f"Unsupported covType: {cov_type}")

    display_cov = _cov_kwargs(req.covType)
    pooled = PooledOLS(data.y, exog).fit(**display_cov)
    fe = PanelOLS(data.y, exog, entity_effects=True).fit(**display_cov)
    re = RandomEffects(data.y, exog).fit(**display_cov)

    # Hausman specification test: compares FE vs RE coefficient vectors on
    # the common (non-const) regressors -- H0 is that RE's extra
    # assumption (regressors uncorrelated with the entity effect) holds, in
    # which case RE is efficient; a significant result means FE is the
    # safer choice. Not built into linearmodels directly, but the formula
    # is standard: H = (b_FE - b_RE)' [Var(b_FE) - Var(b_RE)]^-1 (b_FE - b_RE).
    common = x_cols
    fe_classical = fe if req.covType == "unadjusted" else PanelOLS(data.y, exog, entity_effects=True).fit(cov_type="unadjusted")
    re_classical = re if req.covType == "unadjusted" else RandomEffects(data.y, exog).fit(cov_type="unadjusted")
    common = x_cols
    b_fe = fe_classical.params[common].values
    b_re = re_classical.params[common].values
    v_fe = fe_classical.cov.loc[common, common].values
    v_re = re_classical.cov.loc[common, common].values
    diff = b_fe - b_re
    var_diff = v_fe - v_re
    try:
        stat = float(diff @ np.linalg.inv(var_diff) @ diff)
        dof = len(common)
        pvalue = float(1 - sstats.chi2.cdf(stat, dof))
    except np.linalg.LinAlgError:
        stat, dof, pvalue = float("nan"), len(common), float("nan")

    conclusion = (
        "Reject H0 (p<0.05): Random Effects is likely inconsistent -- use Fixed Effects."
        if pvalue == pvalue and pvalue < 0.05
        else "Fail to reject H0: Random Effects is consistent and more efficient than Fixed Effects here."
        if pvalue == pvalue
        else "Hausman statistic undefined for this data (singular covariance difference)."
    )

    return PanelOlsResponse(
        pooledOls=_to_coef(pooled), fixedEffects=_to_coef(fe), randomEffects=_to_coef(re),
        hausmanStatistic=stat, hausmanPValue=pvalue, hausmanDof=dof, hausmanConclusion=conclusion,
    )


# ─── Hierarchical / mixed-effects panel model ────────────────────────────
class MixedEffectsRequest(BaseModel):
    y: List[float]
    x: List[List[float]]
    groups: List[str]
    randomSlopeIndex: Optional[int] = None


class MixedEffectsResponse(BaseModel):
    fixedEffectsCoefficients: List[float]
    fixedEffectsStandardErrors: List[float]
    fixedEffectsPValues: List[float]
    randomInterceptVariance: float
    randomSlopeVariance: Optional[float] = None
    randomEffectsCovariance: Optional[float] = None
    residualVariance: float
    logLikelihood: float
    converged: bool


def mixed_effects_panel(req: MixedEffectsRequest) -> MixedEffectsResponse:
    from statsmodels.regression.mixed_linear_model import MixedLM

    X = np.column_stack([np.ones(len(req.y)), *req.x])
    y = np.asarray(req.y)
    exog_re = None
    if req.randomSlopeIndex is not None:
        slope_col = req.randomSlopeIndex + 1
        exog_re = X[:, [0, slope_col]]
    results = MixedLM(y, X, groups=np.asarray(req.groups), exog_re=exog_re).fit()
    cov_re = np.asarray(results.cov_re)
    has_slope = exog_re is not None
    return MixedEffectsResponse(
        fixedEffectsCoefficients=results.params[:X.shape[1]].tolist(),
        fixedEffectsStandardErrors=results.bse[:X.shape[1]].tolist(),
        fixedEffectsPValues=results.pvalues[:X.shape[1]].tolist(),
        randomInterceptVariance=float(cov_re[0, 0]),
        randomSlopeVariance=float(cov_re[1, 1]) if has_slope else None,
        randomEffectsCovariance=float(cov_re[0, 1]) if has_slope else None,
        residualVariance=float(results.scale),
        logLikelihood=float(results.llf),
        converged=bool(results.converged),
    )


# ─── 2SLS instrumental variables ──────────────────────────────────────────
class Iv2SlsRequest(BaseModel):
    y: List[float]
    endogenous: List[List[float]]  # the regressor(s) suspected correlated with the error
    instruments: List[List[float]]  # must be >= len(endogenous) columns, correlated with endogenous, not with the error
    exogenous: Optional[List[List[float]]] = None  # other controls, assumed already exogenous


class Iv2SlsResponse(BaseModel):
    coefficients: List[float]
    standardErrors: List[float]
    tStats: List[float]
    pValues: List[float]
    firstStageFStat: float
    overidentified: bool
    sarganStatistic: Optional[float] = None
    sarganPValue: Optional[float] = None
    sarganDegreesOfFreedom: Optional[int] = None


def iv_2sls(req: Iv2SlsRequest) -> Iv2SlsResponse:
    from linearmodels.iv import IV2SLS
    import statsmodels.api as sm

    n = len(req.y)
    y = pd.Series(req.y, name="y")
    endog = pd.DataFrame({f"endog{i}": col for i, col in enumerate(req.endogenous)})
    instr = pd.DataFrame({f"instr{i}": col for i, col in enumerate(req.instruments)})
    exog = pd.DataFrame({"const": [1.0] * n})
    if req.exogenous:
        for i, col in enumerate(req.exogenous):
            exog[f"exog{i}"] = col
    model = IV2SLS(y, exog, endog, instr).fit()

    first_stage_x = sm.add_constant(pd.concat([instr, exog.drop(columns=["const"])], axis=1))
    first_stage = sm.OLS(endog.iloc[:, 0], first_stage_x).fit()
    instr_cols = list(instr.columns)
    restrictions = " = ".join(instr_cols) + " = 0" if len(instr_cols) > 1 else f"{instr_cols[0]} = 0"
    f_test = first_stage.f_test(restrictions)

    overidentified = instr.shape[1] > endog.shape[1]
    sargan_stat = sargan_pvalue = sargan_dof = None
    if overidentified:
        sargan = model.sargan
        if sargan.stat == sargan.stat:
            sargan_stat, sargan_pvalue, sargan_dof = float(sargan.stat), float(sargan.pval), int(sargan.df)
    return Iv2SlsResponse(
        coefficients=model.params.tolist(),
        standardErrors=model.std_errors.tolist(),
        tStats=model.tstats.tolist(),
        pValues=model.pvalues.tolist(),
        firstStageFStat=float(np.asarray(f_test.fvalue).item()),
        overidentified=overidentified,
        sarganStatistic=sargan_stat,
        sarganPValue=sargan_pvalue,
        sarganDegreesOfFreedom=sargan_dof,
    )


# ─── Difference-in-Differences / Regression Discontinuity ────────────────
class DidRequest(BaseModel):
    y: List[float]
    treated: List[float]  # 0/1
    post: List[float]  # 0/1


class DidResponse(BaseModel):
    didEstimate: float
    standardError: float
    pValue: float
    treatedPreMean: float
    treatedPostMean: float
    controlPreMean: float
    controlPostMean: float


def difference_in_differences(req: DidRequest) -> DidResponse:
    import statsmodels.api as sm

    y = np.array(req.y)
    treated = np.array(req.treated)
    post = np.array(req.post)
    X = sm.add_constant(np.column_stack([treated, post, treated * post]))
    model = sm.OLS(y, X).fit()

    def _mean(t, p):
        mask = (treated == t) & (post == p)
        return float(y[mask].mean()) if mask.any() else float("nan")

    return DidResponse(
        didEstimate=float(model.params[-1]),
        standardError=float(model.bse[-1]),
        pValue=float(model.pvalues[-1]),
        treatedPreMean=_mean(1, 0), treatedPostMean=_mean(1, 1),
        controlPreMean=_mean(0, 0), controlPostMean=_mean(0, 1),
    )


class RdRequest(BaseModel):
    y: List[float]
    x: List[float]  # running variable
    cutoff: float


class RdResponse(BaseModel):
    rdEstimate: float  # jump in y at the cutoff
    standardError: float
    pValue: float


def regression_discontinuity(req: RdRequest) -> RdResponse:
    import statsmodels.api as sm

    y = np.array(req.y)
    x = np.array(req.x)
    treated = (x >= req.cutoff).astype(float)
    x_centered = x - req.cutoff
    X = sm.add_constant(np.column_stack([treated, x_centered, treated * x_centered]))
    model = sm.OLS(y, X).fit()
    return RdResponse(rdEstimate=float(model.params[1]), standardError=float(model.bse[1]), pValue=float(model.pvalues[1]))


# ─── Multivariate time series: VAR / VECM / Granger / Johansen / unit root ─
class VarRequest(BaseModel):
    seriesNames: List[str]
    data: List[List[float]]  # one list per series, all the same length
    lags: int = 1
    irfHorizon: int = 10


class VarResponse(BaseModel):
    aic: float
    bic: float
    coefficients: dict  # {equation_name: [coefs...]}
    irf: List[List[List[float]]]  # [horizon][response_series][impulse_series]
    fevd: List[List[List[float]]]  # [horizon][series][contributing_series] as fractions


def var_model(req: VarRequest) -> VarResponse:
    from statsmodels.tsa.api import VAR

    df = pd.DataFrame({name: col for name, col in zip(req.seriesNames, req.data)})
    model = VAR(df)
    results = model.fit(req.lags)
    irf = results.irf(req.irfHorizon)
    fevd = results.fevd(req.irfHorizon)
    return VarResponse(
        aic=float(results.aic), bic=float(results.bic),
        coefficients={name: results.params[name].tolist() for name in req.seriesNames},
        irf=irf.irfs.tolist(),
        fevd=fevd.decomp.tolist(),
    )


class VecmRequest(BaseModel):
    seriesNames: List[str]
    data: List[List[float]]
    cointRank: int = 1
    lags: int = 1


class VecmResponse(BaseModel):
    alpha: List[List[float]]  # loading matrix (speed of adjustment)
    beta: List[List[float]]  # cointegrating vectors
    logLikelihood: float


def vecm_model(req: VecmRequest) -> VecmResponse:
    from statsmodels.tsa.vector_ar.vecm import VECM

    df = pd.DataFrame({name: col for name, col in zip(req.seriesNames, req.data)})
    model = VECM(df, coint_rank=req.cointRank, k_ar_diff=req.lags)
    results = model.fit()
    # VECMResults doesn't expose .aic/.bic (unlike VAR's results) -- .llf
    # (log-likelihood) is the real fit statistic it actually provides.
    return VecmResponse(
        alpha=results.alpha.tolist(), beta=results.beta.tolist(),
        logLikelihood=float(results.llf),
    )


class GrangerRequest(BaseModel):
    y: List[float]
    x: List[float]
    maxLags: int = 4


class GrangerLagResult(BaseModel):
    lag: int
    fStatistic: float
    pValue: float


class GrangerResponse(BaseModel):
    results: List[GrangerLagResult]  # does x Granger-cause y, tested at each lag 1..maxLags
    conclusion: str


def granger_causality(req: GrangerRequest) -> GrangerResponse:
    from statsmodels.tsa.stattools import grangercausalitytests

    data = np.column_stack([req.y, req.x])
    raw = grangercausalitytests(data, req.maxLags, verbose=False)
    results = [
        GrangerLagResult(lag=lag, fStatistic=float(test[0]["ssr_ftest"][0]), pValue=float(test[0]["ssr_ftest"][1]))
        for lag, test in raw.items()
    ]
    any_significant = any(r.pValue < 0.05 for r in results)
    conclusion = (
        "At least one lag is significant (p<0.05): x Granger-causes y (x's past values help predict y beyond y's own past)."
        if any_significant
        else "No lag is significant: no evidence x Granger-causes y."
    )
    return GrangerResponse(results=results, conclusion=conclusion)


class JohansenRequest(BaseModel):
    seriesNames: List[str]
    data: List[List[float]]
    detOrder: int = 0
    kArDiff: int = 1


class JohansenResponse(BaseModel):
    traceStatistics: List[float]
    traceCriticalValues95: List[float]  # 95% critical value, one per rank hypothesis
    maxEigStatistics: List[float]
    maxEigCriticalValues95: List[float]
    likelyCointegratingRank: int  # count of trace stats exceeding their 95% critical value


def johansen_cointegration(req: JohansenRequest) -> JohansenResponse:
    from statsmodels.tsa.vector_ar.vecm import coint_johansen

    df = pd.DataFrame({name: col for name, col in zip(req.seriesNames, req.data)})
    result = coint_johansen(df.values, req.detOrder, req.kArDiff)
    trace_crit_95 = result.cvt[:, 1].tolist()  # column 1 is the 95% critical value
    max_eig_crit_95 = result.cvm[:, 1].tolist()
    rank = sum(1 for stat, crit in zip(result.lr1.tolist(), trace_crit_95) if stat > crit)
    return JohansenResponse(
        traceStatistics=result.lr1.tolist(), traceCriticalValues95=trace_crit_95,
        maxEigStatistics=result.lr2.tolist(), maxEigCriticalValues95=max_eig_crit_95,
        likelyCointegratingRank=rank,
    )


class UnitRootRequest(BaseModel):
    series: List[float]


class UnitRootResponse(BaseModel):
    adfStatistic: float
    adfPValue: float
    kpssStatistic: float
    kpssPValue: float
    conclusion: str


def unit_root_tests(req: UnitRootRequest) -> UnitRootResponse:
    from statsmodels.tsa.stattools import adfuller, kpss

    adf = adfuller(req.series)
    kp = kpss(req.series, nlags="auto")
    adf_stationary = adf[1] < 0.05  # ADF H0 = unit root (non-stationary); reject -> stationary
    kpss_stationary = kp[1] > 0.05  # KPSS H0 = stationary; fail to reject -> stationary
    if adf_stationary and kpss_stationary:
        conclusion = "Both tests agree: the series is stationary."
    elif not adf_stationary and not kpss_stationary:
        conclusion = "Both tests agree: the series has a unit root (non-stationary)."
    else:
        conclusion = "ADF and KPSS disagree -- often a sign of a trend-stationary series; inspect visually."
    return UnitRootResponse(
        adfStatistic=float(adf[0]), adfPValue=float(adf[1]),
        kpssStatistic=float(kp[0]), kpssPValue=float(kp[1]),
        conclusion=conclusion,
    )


# ─── Heteroskedasticity / quantile regression / SUR ───────────────────────
class HeteroskedasticityRequest(BaseModel):
    residuals: List[float]
    x: List[List[float]]


class HeteroskedasticityResponse(BaseModel):
    breuschPaganStatistic: float
    breuschPaganPValue: float
    conclusion: str


def heteroskedasticity_tests(req: HeteroskedasticityRequest) -> HeteroskedasticityResponse:
    import statsmodels.api as sm
    from statsmodels.stats.diagnostic import het_breuschpagan

    X = sm.add_constant(np.column_stack(req.x))
    stat, pvalue, _, _ = het_breuschpagan(req.residuals, X)
    conclusion = (
        "Reject H0 (p<0.05): evidence of heteroskedasticity -- OLS standard errors may be unreliable, consider GLS/WLS or robust SEs."
        if pvalue < 0.05
        else "Fail to reject H0: no strong evidence of heteroskedasticity."
    )
    return HeteroskedasticityResponse(breuschPaganStatistic=float(stat), breuschPaganPValue=float(pvalue), conclusion=conclusion)


class QuantileRegressionRequest(BaseModel):
    y: List[float]
    x: List[List[float]]
    quantile: float = 0.5


class QuantileRegressionResponse(BaseModel):
    coefficients: List[float]
    standardErrors: List[float]
    tStats: List[float]
    pValues: List[float]
    pseudoRSquared: float


def quantile_regression(req: QuantileRegressionRequest) -> QuantileRegressionResponse:
    import statsmodels.api as sm

    X = sm.add_constant(np.column_stack(req.x))
    y = np.array(req.y)
    model = sm.QuantReg(y, X).fit(q=req.quantile)
    return QuantileRegressionResponse(
        coefficients=model.params.tolist(), standardErrors=model.bse.tolist(),
        tStats=model.tvalues.tolist(), pValues=model.pvalues.tolist(),
        pseudoRSquared=float(model.prsquared),
    )


class SurEquationInput(BaseModel):
    name: str
    y: List[float]
    x: List[List[float]]


class SurRequest(BaseModel):
    equations: List[SurEquationInput]


class SurEquationResult(BaseModel):
    name: str
    coefficients: List[float]
    standardErrors: List[float]
    pValues: List[float]


class SurResponse(BaseModel):
    equations: List[SurEquationResult]
    residualCorrelation: List[List[float]]  # cross-equation residual correlation -- SUR's whole reason to exist over separate OLS


def seemingly_unrelated_regression(req: SurRequest) -> SurResponse:
    from linearmodels.system import SUR
    import statsmodels.api as sm

    equations = {
        eq.name: {"dependent": np.array(eq.y), "exog": sm.add_constant(np.column_stack(eq.x))}
        for eq in req.equations
    }
    model = SUR(equations)
    results = model.fit()

    eq_results = []
    for eq in req.equations:
        params = results.equations[eq.name].params
        bse = results.equations[eq.name].std_errors
        pvalues = results.equations[eq.name].pvalues
        eq_results.append(SurEquationResult(name=eq.name, coefficients=params.tolist(), standardErrors=bse.tolist(), pValues=pvalues.tolist()))

    resid_df = pd.DataFrame({eq.name: results.equations[eq.name].resids for eq in req.equations})
    corr = resid_df.corr().values.tolist()

    return SurResponse(equations=eq_results, residualCorrelation=corr)
