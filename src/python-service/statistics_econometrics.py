"""
Statistics & econometrics foundation (LIMURIA_ENGINES port plan Phase 2a) --
real scipy.stats / statsmodels routines. Genuinely hard to reproduce
correctly by hand: Shapiro-Wilk's W-statistic distribution, exact
Mann-Whitney/Wilcoxon critical values, and statsmodels' full OLS/GLS/Logit/
Probit diagnostics (proper standard errors, t/F distributions, AIC/BIC) are
exactly the kind of "mature library beats hand-rolled" case this sidecar
exists for. Ported from LIMURIA_ENGINES' engines/02_statistics.py, verified
real there -- one exception: that file's `correlation_analysis()` computes
partial correlation against a literal `np.random.randn()` placeholder
("Mock Z for partial corr"), which is not a real feature (partial
correlation needs a real third variable to control for). Implemented here
instead as its own endpoint taking a genuine third series.
"""

from typing import List, Literal, Optional

import numpy as np
from pydantic import BaseModel
from scipy import stats

CovType = Literal["nonrobust", "HC1", "HC3", "HAC", "cluster"]


def _cov_fit_kwargs(cov_type: str, cluster_var: Optional[List[str]], max_lags: Optional[int], nobs: int) -> dict:
    """Map the supported covariance choices to statsmodels' native fit API."""
    if cov_type == "nonrobust":
        return {}
    if cov_type in ("HC1", "HC3"):
        return {"cov_type": cov_type}
    if cov_type == "HAC":
        lags = max_lags if max_lags is not None else int(np.floor(4 * (nobs / 100) ** (2 / 9)))
        return {"cov_type": "HAC", "cov_kwds": {"maxlags": max(lags, 0)}}
    if cov_type == "cluster":
        if not cluster_var:
            raise ValueError("clusterVar is required when covType='cluster'.")
        groups = np.unique(np.asarray(cluster_var), return_inverse=True)[1]
        return {"cov_type": "cluster", "cov_kwds": {"groups": groups}}
    raise ValueError(f"Unsupported covType: {cov_type}")


# ─── Normality tests ─────────────────────────────────────────────────────
class NormalityRequest(BaseModel):
    data: List[float]


class NormalityResponse(BaseModel):
    shapiroWilkStat: Optional[float] = None
    shapiroWilkPValue: Optional[float] = None
    ksStat: float
    ksPValue: float
    jarqueBeraStat: float
    jarqueBeraPValue: float
    dagostinoStat: Optional[float] = None
    dagostinoPValue: Optional[float] = None


def normality_tests(req: NormalityRequest) -> NormalityResponse:
    d = np.array(req.data)
    shapiro_stat = shapiro_p = None
    if 3 <= len(d) <= 5000:  # scipy's documented Shapiro-Wilk sample-size range
        sw = stats.shapiro(d)
        shapiro_stat, shapiro_p = float(sw.statistic), float(sw.pvalue)
    ks = stats.kstest(d, "norm", args=(d.mean(), d.std(ddof=1)))
    jb = stats.jarque_bera(d)
    dag_stat = dag_p = None
    if len(d) >= 8:  # scipy's documented minimum for normaltest
        dag = stats.normaltest(d)
        dag_stat, dag_p = float(dag.statistic), float(dag.pvalue)
    return NormalityResponse(
        shapiroWilkStat=shapiro_stat, shapiroWilkPValue=shapiro_p,
        ksStat=float(ks.statistic), ksPValue=float(ks.pvalue),
        jarqueBeraStat=float(jb.statistic), jarqueBeraPValue=float(jb.pvalue),
        dagostinoStat=dag_stat, dagostinoPValue=dag_p,
    )


# ─── Hypothesis tests (two-sample) ───────────────────────────────────────
class HypothesisTestRequest(BaseModel):
    group1: List[float]
    group2: List[float]


class TestResult(BaseModel):
    statistic: float
    pValue: float


class HypothesisTestResponse(BaseModel):
    independentTTest: TestResult
    pairedTTest: Optional[TestResult] = None  # only valid when both groups are the same length
    mannWhitneyU: TestResult
    wilcoxon: Optional[TestResult] = None  # same-length requirement as paired t-test
    kruskalWallis: TestResult
    anova: TestResult


def hypothesis_tests(req: HypothesisTestRequest) -> HypothesisTestResponse:
    g1, g2 = np.array(req.group1), np.array(req.group2)
    same_length = len(g1) == len(g2)
    ind_t = stats.ttest_ind(g1, g2)
    paired_t = stats.ttest_rel(g1, g2) if same_length else None
    mw = stats.mannwhitneyu(g1, g2)
    wc = stats.wilcoxon(g1, g2) if same_length else None
    kw = stats.kruskal(g1, g2)
    anova = stats.f_oneway(g1, g2)
    return HypothesisTestResponse(
        independentTTest=TestResult(statistic=float(ind_t.statistic), pValue=float(ind_t.pvalue)),
        pairedTTest=TestResult(statistic=float(paired_t.statistic), pValue=float(paired_t.pvalue)) if paired_t else None,
        mannWhitneyU=TestResult(statistic=float(mw.statistic), pValue=float(mw.pvalue)),
        wilcoxon=TestResult(statistic=float(wc.statistic), pValue=float(wc.pvalue)) if wc else None,
        kruskalWallis=TestResult(statistic=float(kw.statistic), pValue=float(kw.pvalue)),
        anova=TestResult(statistic=float(anova.statistic), pValue=float(anova.pvalue)),
    )


# ─── Correlation suite ───────────────────────────────────────────────────
class CorrelationRequest(BaseModel):
    x: List[float]
    y: List[float]


class CorrelationResponse(BaseModel):
    pearson: TestResult
    spearman: TestResult
    kendall: TestResult


def correlation_analysis(req: CorrelationRequest) -> CorrelationResponse:
    x, y = np.array(req.x), np.array(req.y)
    p = stats.pearsonr(x, y)
    s = stats.spearmanr(x, y)
    k = stats.kendalltau(x, y)
    return CorrelationResponse(
        pearson=TestResult(statistic=float(p.statistic), pValue=float(p.pvalue)),
        spearman=TestResult(statistic=float(s.statistic), pValue=float(s.pvalue)),
        kendall=TestResult(statistic=float(k.statistic), pValue=float(k.pvalue)),
    )


class PartialCorrelationRequest(BaseModel):
    x: List[float]
    y: List[float]
    z: List[float]  # the real control variable -- not a random placeholder


class PartialCorrelationResponse(BaseModel):
    partialCorrelation: float
    pValue: float
    degreesOfFreedom: int


def partial_correlation(req: PartialCorrelationRequest) -> PartialCorrelationResponse:
    x, y, z = np.array(req.x), np.array(req.y), np.array(req.z)
    r_xy = stats.pearsonr(x, y).statistic
    r_xz = stats.pearsonr(x, z).statistic
    r_yz = stats.pearsonr(y, z).statistic
    denom = np.sqrt((1 - r_xz ** 2) * (1 - r_yz ** 2))
    r_partial = (r_xy - r_xz * r_yz) / denom if denom > 1e-12 else 0.0
    n = len(x)
    dof = n - 3
    if dof > 0 and abs(r_partial) < 1:
        t_stat = r_partial * np.sqrt(dof / (1 - r_partial ** 2))
        p_value = 2 * (1 - stats.t.cdf(abs(t_stat), dof))
    else:
        p_value = 1.0
    return PartialCorrelationResponse(partialCorrelation=float(r_partial), pValue=float(p_value), degreesOfFreedom=dof)


# ─── Regression models (statsmodels, full diagnostics) ───────────────────
class RegressionRequest(BaseModel):
    y: List[float]
    x: List[List[float]]  # one list per predictor column (not per row)
    covType: CovType = "nonrobust"
    clusterVar: Optional[List[str]] = None
    maxLags: Optional[int] = None


class RegressionResponse(BaseModel):
    coefficients: List[float]  # [intercept, beta_1, beta_2, ...]
    standardErrors: List[float]
    tStats: List[float]
    pValues: List[float]
    rSquared: float
    adjRSquared: float
    fStatistic: float
    fPValue: float
    aic: float
    bic: float
    durbinWatson: float
    residuals: List[float]
    covType: str = "nonrobust"


def _design_matrix(x_columns: List[List[float]]):
    import statsmodels.api as sm
    X = np.column_stack(x_columns)
    return sm.add_constant(X)


def ols_diagnostics(req: RegressionRequest) -> RegressionResponse:
    import statsmodels.api as sm
    from statsmodels.stats.stattools import durbin_watson

    X = _design_matrix(req.x)
    y = np.array(req.y)
    results = sm.OLS(y, X).fit(**_cov_fit_kwargs(req.covType, req.clusterVar, req.maxLags, len(y)))
    return RegressionResponse(
        coefficients=results.params.tolist(),
        standardErrors=results.bse.tolist(),
        tStats=results.tvalues.tolist(),
        pValues=results.pvalues.tolist(),
        rSquared=float(results.rsquared),
        adjRSquared=float(results.rsquared_adj),
        fStatistic=float(results.fvalue),
        fPValue=float(results.f_pvalue),
        aic=float(results.aic),
        bic=float(results.bic),
        durbinWatson=float(durbin_watson(results.resid)),
        residuals=results.resid.tolist(),
        covType=req.covType,
    )


class WeightedRegressionRequest(RegressionRequest):
    weights: List[float]


def gls_regression(req: WeightedRegressionRequest) -> RegressionResponse:
    import statsmodels.api as sm
    from statsmodels.stats.stattools import durbin_watson

    X = _design_matrix(req.x)
    y = np.array(req.y)
    results = sm.WLS(y, X, weights=1.0 / np.array(req.weights)).fit(
        **_cov_fit_kwargs(req.covType, req.clusterVar, req.maxLags, len(y))
    )
    return RegressionResponse(
        coefficients=results.params.tolist(),
        standardErrors=results.bse.tolist(),
        tStats=results.tvalues.tolist(),
        pValues=results.pvalues.tolist(),
        rSquared=float(results.rsquared),
        adjRSquared=float(results.rsquared_adj),
        fStatistic=float(results.fvalue),
        fPValue=float(results.f_pvalue),
        aic=float(results.aic),
        bic=float(results.bic),
        durbinWatson=float(durbin_watson(results.resid)),
        residuals=results.resid.tolist(),
        covType=req.covType,
    )


class BinaryRegressionResponse(BaseModel):
    coefficients: List[float]
    standardErrors: List[float]
    zStats: List[float]
    pValues: List[float]
    oddsRatios: Optional[List[float]] = None
    pseudoRSquared: float
    logLikelihood: float


def logistic_regression(req: RegressionRequest) -> BinaryRegressionResponse:
    import statsmodels.api as sm

    X = _design_matrix(req.x)
    y = np.array(req.y)
    results = sm.Logit(y, X).fit(disp=0)
    return BinaryRegressionResponse(
        coefficients=results.params.tolist(),
        standardErrors=results.bse.tolist(),
        zStats=results.tvalues.tolist(),
        pValues=results.pvalues.tolist(),
        oddsRatios=np.exp(results.params).tolist(),
        pseudoRSquared=float(results.prsquared),
        logLikelihood=float(results.llf),
    )


def probit_regression(req: RegressionRequest) -> BinaryRegressionResponse:
    import statsmodels.api as sm

    X = _design_matrix(req.x)
    y = np.array(req.y)
    results = sm.Probit(y, X).fit(disp=0)
    return BinaryRegressionResponse(
        coefficients=results.params.tolist(),
        standardErrors=results.bse.tolist(),
        zStats=results.tvalues.tolist(),
        pValues=results.pvalues.tolist(),
        oddsRatios=None,
        pseudoRSquared=float(results.prsquared),
        logLikelihood=float(results.llf),
    )


# ─── Robust M-estimator regression ──────────────────────────────────────
class RobustRegressionRequest(BaseModel):
    y: List[float]
    x: List[List[float]]
    normType: Literal["huber", "bisquare", "tukey"] = "huber"


class RobustRegressionResponse(BaseModel):
    coefficients: List[float]
    standardErrors: List[float]
    tStats: List[float]
    pValues: List[float]
    weights: List[float]
    residuals: List[float]
    scale: float


def robust_regression(req: RobustRegressionRequest) -> RobustRegressionResponse:
    from statsmodels.robust.norms import HuberT, TukeyBiweight
    from statsmodels.robust.robust_linear_model import RLM

    X = _design_matrix(req.x)
    y = np.array(req.y)
    norm = HuberT() if req.normType == "huber" else TukeyBiweight()
    results = RLM(y, X, M=norm).fit()
    weights = getattr(results, "weights", None)
    if weights is None:
        # Statsmodels omits the wrapper property for a perfect Tukey fit;
        # the final IRLS weights are exactly one when residual scale is zero.
        weights = np.ones(len(y)) if results.scale == 0 else norm.weights(results.resid / results.scale)
    return RobustRegressionResponse(
        coefficients=results.params.tolist(),
        standardErrors=results.bse.tolist(),
        tStats=results.tvalues.tolist(),
        pValues=results.pvalues.tolist(),
        weights=np.asarray(weights).tolist(),
        residuals=results.resid.tolist(),
        scale=float(results.scale),
    )


# ─── Influence diagnostics ──────────────────────────────────────────────
class InfluenceDiagnosticsResponse(BaseModel):
    cooksDistance: List[float]
    leverage: List[float]
    dffits: List[float]
    standardizedResiduals: List[float]
    studentizedResiduals: List[float]
    influenceThreshold: float
    flaggedObservations: List[int]


def influence_diagnostics(req: RegressionRequest) -> InfluenceDiagnosticsResponse:
    import statsmodels.api as sm
    from statsmodels.stats.outliers_influence import OLSInfluence

    X = _design_matrix(req.x)
    y = np.array(req.y)
    results = sm.OLS(y, X).fit()
    infl = OLSInfluence(results)
    cooks = np.asarray(infl.cooks_distance[0])
    threshold = 4.0 / len(y)
    return InfluenceDiagnosticsResponse(
        cooksDistance=cooks.tolist(),
        leverage=np.asarray(infl.hat_matrix_diag).tolist(),
        dffits=np.asarray(infl.dffits[0]).tolist(),
        standardizedResiduals=np.asarray(infl.resid_studentized_internal).tolist(),
        studentizedResiduals=np.asarray(infl.resid_studentized_external).tolist(),
        influenceThreshold=float(threshold),
        flaggedObservations=[i for i, value in enumerate(cooks) if value > threshold],
    )


# ─── VIF / RESET / residual autocorrelation ─────────────────────────────
class VifRequest(BaseModel):
    x: List[List[float]]


class VifResponse(BaseModel):
    predictorIndex: List[int]
    vif: List[float]


def variance_inflation_factors(req: VifRequest) -> VifResponse:
    from statsmodels.stats.outliers_influence import variance_inflation_factor

    X = _design_matrix(req.x)
    return VifResponse(
        predictorIndex=list(range(1, X.shape[1])),
        vif=[float(variance_inflation_factor(X, i)) for i in range(1, X.shape[1])],
    )


class ResetTestResponse(BaseModel):
    statistic: float
    pValue: float
    degreesOfFreedomNumerator: int
    degreesOfFreedomDenominator: int
    conclusion: str


def reset_test(req: RegressionRequest) -> ResetTestResponse:
    import statsmodels.api as sm
    from statsmodels.stats.diagnostic import linear_reset

    results = sm.OLS(np.array(req.y), _design_matrix(req.x)).fit()
    reset = linear_reset(results, power=3, test_type="fitted", use_f=True)
    return ResetTestResponse(
        statistic=float(reset.fvalue),
        pValue=float(reset.pvalue),
        degreesOfFreedomNumerator=int(reset.df_num),
        degreesOfFreedomDenominator=int(reset.df_denom),
        conclusion=(
            "Reject H0 (p<0.05): functional-form misspecification detected."
            if reset.pvalue < 0.05
            else "Fail to reject H0: no strong evidence of functional-form misspecification."
        ),
    )


class AutocorrelationTestRequest(BaseModel):
    y: List[float]
    x: List[List[float]]
    lags: int = 4


class AutocorrelationTestResponse(BaseModel):
    breuschGodfreyLmStatistic: float
    breuschGodfreyLmPValue: float
    breuschGodfreyFStatistic: float
    breuschGodfreyFPValue: float
    ljungBoxLags: List[int]
    ljungBoxStatistics: List[float]
    ljungBoxPValues: List[float]
    durbinWatson: float
    conclusion: str


def autocorrelation_tests(req: AutocorrelationTestRequest) -> AutocorrelationTestResponse:
    import statsmodels.api as sm
    from statsmodels.stats.diagnostic import acorr_breusch_godfrey, acorr_ljungbox
    from statsmodels.stats.stattools import durbin_watson

    results = sm.OLS(np.array(req.y), _design_matrix(req.x)).fit()
    lm, lm_p, f, f_p = acorr_breusch_godfrey(results, nlags=req.lags)
    lb = acorr_ljungbox(results.resid, lags=req.lags)
    significant = lm_p < 0.05 or bool((lb["lb_pvalue"] < 0.05).any())
    return AutocorrelationTestResponse(
        breuschGodfreyLmStatistic=float(lm),
        breuschGodfreyLmPValue=float(lm_p),
        breuschGodfreyFStatistic=float(f),
        breuschGodfreyFPValue=float(f_p),
        ljungBoxLags=[int(v) for v in lb.index.tolist()],
        ljungBoxStatistics=lb["lb_stat"].tolist(),
        ljungBoxPValues=lb["lb_pvalue"].tolist(),
        durbinWatson=float(durbin_watson(results.resid)),
        conclusion=(
            "Reject H0 (p<0.05) on at least one test: residuals show significant autocorrelation."
            if significant
            else "Fail to reject H0: no strong evidence of residual autocorrelation."
        ),
    )
