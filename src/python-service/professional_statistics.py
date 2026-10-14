"""Professional statistical analysis for Quant Lab Phase A4.

The module intentionally composes mature SciPy, statsmodels, and scikit-learn
implementations. Every stochastic routine accepts an explicit seed and every
result carries assumptions or diagnostics needed to interpret the number.
"""

from typing import Any, Dict, List, Literal, Optional
import warnings

import numpy as np
from pydantic import BaseModel, Field
from scipy import stats


class StatisticsResponse(BaseModel):
    result: Dict[str, Any]
    diagnostics: Dict[str, Any]
    warnings: List[str] = []


def _finite(values: List[Optional[float]], minimum: int = 3) -> tuple[np.ndarray, int]:
    clean = np.asarray([value for value in values if value is not None and np.isfinite(value)], dtype=float)
    if clean.size < minimum:
        raise ValueError(f"At least {minimum} finite observations are required.")
    return clean, len(values) - clean.size


def _number(value: Any) -> Optional[float]:
    value = float(value)
    return value if np.isfinite(value) else None


def _interval(values: np.ndarray, confidence: float) -> List[float]:
    low, high = np.quantile(values, [(1 - confidence) / 2, 1 - (1 - confidence) / 2])
    return [float(low), float(high)]


class DescriptiveRequest(BaseModel):
    data: List[Optional[float]] = Field(min_length=3, max_length=100000)
    quantiles: List[float] = Field(default=[0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99], max_length=25)
    trimProportion: float = Field(default=0.05, ge=0, lt=0.5)
    winsorProportion: float = Field(default=0.05, ge=0, lt=0.5)
    outlierZThreshold: float = Field(default=3.5, gt=0, le=20)


def descriptive_diagnostics(req: DescriptiveRequest) -> StatisticsResponse:
    x, missing = _finite(req.data)
    if any(q < 0 or q > 1 for q in req.quantiles):
        raise ValueError("Quantiles must be between zero and one.")
    median = float(np.median(x))
    mad_raw = float(np.median(np.abs(x - median)))
    robust_z = np.zeros_like(x) if mad_raw == 0 else 0.6744897501960817 * (x - median) / mad_raw
    q1, q3 = np.quantile(x, [0.25, 0.75]); iqr = float(q3 - q1)
    iqr_mask = (x < q1 - 1.5 * iqr) | (x > q3 + 1.5 * iqr)
    robust_mask = np.abs(robust_z) > req.outlierZThreshold
    lower, upper = np.quantile(x, [req.winsorProportion, 1 - req.winsorProportion])
    winsorized = np.clip(x, lower, upper)
    result = {
        "count": int(x.size), "missingCount": int(missing), "missingRate": missing / len(req.data),
        "mean": float(np.mean(x)), "trimmedMean": float(stats.trim_mean(x, req.trimProportion)),
        "median": median, "variance": float(np.var(x, ddof=1)), "standardDeviation": float(np.std(x, ddof=1)),
        "standardError": float(stats.sem(x)), "mad": float(stats.median_abs_deviation(x, scale="normal")),
        "iqr": iqr, "minimum": float(np.min(x)), "maximum": float(np.max(x)), "range": float(np.ptp(x)),
        "skewness": _number(stats.skew(x, bias=False)), "excessKurtosis": _number(stats.kurtosis(x, fisher=True, bias=False)),
        "coefficientOfVariation": None if abs(np.mean(x)) < 1e-15 else float(np.std(x, ddof=1) / np.mean(x)),
        "quantiles": {str(q): float(np.quantile(x, q)) for q in req.quantiles},
        "winsorized": {"lowerBound": float(lower), "upperBound": float(upper), "mean": float(np.mean(winsorized)), "standardDeviation": float(np.std(winsorized, ddof=1))},
        "outliers": {"iqrCount": int(iqr_mask.sum()), "robustZCount": int(robust_mask.sum()), "robustZValues": x[robust_mask].tolist()[:100]},
    }
    warnings = []
    if missing: warnings.append("Missing or non-finite observations were excluded; inspect the missingness mechanism before inference.")
    if iqr_mask.any() or robust_mask.any(): warnings.append("Potential outliers are flagged, not automatically removed; investigate provenance and sensitivity.")
    if x.size < 30: warnings.append("Small samples make higher moments and tail quantiles unstable.")
    return StatisticsResponse(result=result, diagnostics={"ddof": 1, "madScale": "normal", "iqrRule": 1.5, "robustZThreshold": req.outlierZThreshold}, warnings=warnings)


class DistributionFitRequest(BaseModel):
    data: List[float] = Field(min_length=8, max_length=10000)
    distributions: List[Literal["normal", "student_t", "lognormal", "gamma"]] = ["normal", "student_t", "lognormal", "gamma"]
    nMcSamples: int = Field(default=999, ge=199, le=4999)
    seed: int = Field(ge=0, le=2147483647)


_DISTRIBUTIONS = {"normal": stats.norm, "student_t": stats.t, "lognormal": stats.lognorm, "gamma": stats.gamma}


def distribution_fit(req: DistributionFitRequest) -> StatisticsResponse:
    x, _ = _finite(req.data, 8); rng = np.random.default_rng(req.seed); fits = []
    for name in dict.fromkeys(req.distributions):
        distribution = _DISTRIBUTIONS[name]
        if name in ("lognormal", "gamma") and np.any(x <= 0):
            fits.append({"distribution": name, "eligible": False, "reason": "Requires strictly positive observations."})
            continue
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            params = distribution.fit(x, **({"floc": 0} if name in ("lognormal", "gamma") else {}))
            log_likelihood = float(np.sum(distribution.logpdf(x, *params)))
            k = len(params); aic = 2 * k - 2 * log_likelihood; bic = k * np.log(x.size) - 2 * log_likelihood
            gof = stats.goodness_of_fit(distribution, x, fit_params=None, statistic="ad", n_mc_samples=req.nMcSamples, random_state=rng)
        fits.append({"distribution": name, "eligible": True, "parameters": [float(v) for v in params], "logLikelihood": log_likelihood,
                     "aic": float(aic), "bic": float(bic), "andersonDarling": float(gof.statistic), "gofPValue": float(gof.pvalue)})
    eligible = [fit for fit in fits if fit.get("eligible")]
    if not eligible: raise ValueError("None of the requested distributions is eligible for this data.")
    best = min(eligible, key=lambda fit: fit["aic"]); distribution = _DISTRIBUTIONS[best["distribution"]]
    probabilities = (np.arange(1, x.size + 1) - 0.5) / x.size
    theoretical = distribution.ppf(probabilities, *best["parameters"])
    stride = max(1, x.size // 200)
    qq = [{"theoretical": float(a), "observed": float(b)} for a, b in zip(theoretical[::stride], np.sort(x)[::stride])]
    return StatisticsResponse(result={"bestByAic": best["distribution"], "fits": fits, "qq": qq},
      diagnostics={"criterion": "AIC", "goodnessOfFit": "Monte Carlo Anderson-Darling with parameters re-fitted per sample", "mcSamples": req.nMcSamples, "seed": req.seed},
      warnings=["A fitted distribution is a working approximation, not proof that the data-generating process belongs to that family."])


class InferenceRequest(BaseModel):
    group1: List[float] = Field(min_length=3, max_length=50000)
    group2: Optional[List[float]] = Field(default=None, min_length=3, max_length=50000)
    paired: bool = False
    alpha: float = Field(default=0.05, gt=0, lt=0.5)
    alternative: Literal["two-sided", "less", "greater"] = "two-sided"
    targetPower: float = Field(default=0.8, gt=0.5, lt=1)


def professional_inference(req: InferenceRequest) -> StatisticsResponse:
    from statsmodels.stats.power import TTestIndPower, TTestPower
    x, _ = _finite(req.group1); confidence = 1 - req.alpha; tests = []; assumptions = {}
    power_alternative = {"two-sided": "two-sided", "less": "smaller", "greater": "larger"}[req.alternative]
    mean = float(np.mean(x)); se = float(stats.sem(x)); ci = stats.t.interval(confidence, x.size - 1, loc=mean, scale=se)
    result: Dict[str, Any] = {"group1": {"n": int(x.size), "mean": mean, "confidenceInterval": [float(ci[0]), float(ci[1])]}, "tests": tests}
    if req.group2 is None:
        test = stats.ttest_1samp(x, 0, alternative=req.alternative)
        effect = mean / np.std(x, ddof=1)
        required = TTestPower().solve_power(effect_size=max(abs(effect), 1e-9), alpha=req.alpha, power=req.targetPower, alternative=power_alternative)
        tests.append({"name": "one_sample_t", "statistic": float(test.statistic), "pValue": float(test.pvalue), "effectSize": {"cohensD": float(effect)}})
        result["power"] = {"observed": float(TTestPower().power(effect_size=abs(effect), nobs=x.size, alpha=req.alpha, alternative=power_alternative)), "requiredSampleSize": int(np.ceil(required)), "target": req.targetPower}
    else:
        y, _ = _finite(req.group2)
        if req.paired and x.size != y.size: raise ValueError("Paired inference requires equal sample sizes.")
        assumptions["shapiroPValues"] = [float(stats.shapiro(x).pvalue), float(stats.shapiro(y).pvalue)]
        assumptions["levenePValue"] = float(stats.levene(x, y, center="median").pvalue)
        if req.paired:
            differences = x - y; test = stats.ttest_rel(x, y, alternative=req.alternative); sd = np.std(differences, ddof=1)
            effect = float(np.mean(differences) / sd) if sd else 0.0
            nonparametric = stats.wilcoxon(x, y, alternative=req.alternative)
            power_model = TTestPower(); observed = power_model.power(abs(effect), x.size, req.alpha, alternative=power_alternative)
            required = power_model.solve_power(max(abs(effect), 1e-9), power=req.targetPower, alpha=req.alpha, alternative=power_alternative)
            tests.extend([{"name": "paired_t", "statistic": float(test.statistic), "pValue": float(test.pvalue), "effectSize": {"cohensDz": effect}},
                          {"name": "wilcoxon_signed_rank", "statistic": float(nonparametric.statistic), "pValue": float(nonparametric.pvalue)}])
        else:
            test = stats.ttest_ind(x, y, equal_var=False, alternative=req.alternative)
            pooled = np.sqrt(((x.size - 1) * np.var(x, ddof=1) + (y.size - 1) * np.var(y, ddof=1)) / (x.size + y.size - 2))
            d = float((np.mean(x) - np.mean(y)) / pooled) if pooled else 0.0
            correction = 1 - 3 / (4 * (x.size + y.size) - 9); effect = d * correction
            mw = stats.mannwhitneyu(x, y, alternative=req.alternative)
            rank_biserial = 2 * float(mw.statistic) / (x.size * y.size) - 1
            power_model = TTestIndPower(); observed = power_model.power(abs(effect), x.size, req.alpha, ratio=y.size / x.size, alternative=power_alternative)
            required = power_model.solve_power(max(abs(effect), 1e-9), power=req.targetPower, alpha=req.alpha, ratio=y.size / x.size, alternative=power_alternative)
            tests.extend([{"name": "welch_t", "statistic": float(test.statistic), "pValue": float(test.pvalue), "effectSize": {"cohensD": d, "hedgesG": effect}},
                          {"name": "mann_whitney_u", "statistic": float(mw.statistic), "pValue": float(mw.pvalue), "effectSize": {"rankBiserial": rank_biserial}}])
        diff = float(np.mean(x) - np.mean(y))
        if req.paired:
            diff_se = float(stats.sem(x - y)); dof = x.size - 1
        else:
            diff_se = np.sqrt(np.var(x, ddof=1) / x.size + np.var(y, ddof=1) / y.size)
            dof = (np.var(x, ddof=1) / x.size + np.var(y, ddof=1) / y.size) ** 2 / ((np.var(x, ddof=1) / x.size) ** 2 / (x.size - 1) + (np.var(y, ddof=1) / y.size) ** 2 / (y.size - 1))
        diff_ci = stats.t.interval(confidence, dof, loc=diff, scale=diff_se)
        result.update({"group2": {"n": int(y.size), "mean": float(np.mean(y))}, "meanDifference": diff, "meanDifferenceConfidenceInterval": [float(diff_ci[0]), float(diff_ci[1])],
                       "power": {"observed": float(observed), "requiredGroup1SampleSize": int(np.ceil(required)), "target": req.targetPower}})
    warnings = ["Statistical significance is not economic significance; interpret effect sizes and intervals together."]
    if any(value < req.alpha for value in assumptions.get("shapiroPValues", [])): warnings.append("Normality is questionable; compare parametric and rank-based results.")
    return StatisticsResponse(result=result, diagnostics={"alpha": req.alpha, "alternative": req.alternative, "paired": req.paired, "assumptions": assumptions}, warnings=warnings)


class ResamplingRequest(BaseModel):
    data: List[float] = Field(min_length=5, max_length=10000)
    group2: Optional[List[float]] = Field(default=None, min_length=5, max_length=10000)
    statistic: Literal["mean", "median", "standard_deviation"] = "mean"
    confidence: float = Field(default=0.95, gt=0.5, lt=1)
    iterations: int = Field(default=2000, ge=200, le=20000)
    blockLength: int = Field(default=5, ge=2, le=1000)
    seed: int = Field(ge=0, le=2147483647)


def seeded_resampling(req: ResamplingRequest) -> StatisticsResponse:
    x, _ = _finite(req.data, 5); rng = np.random.default_rng(req.seed)
    funcs = {"mean": np.mean, "median": np.median, "standard_deviation": lambda v: np.std(v, ddof=1)}; fn = funcs[req.statistic]
    bootstrap = stats.bootstrap((x,), fn, n_resamples=req.iterations, confidence_level=req.confidence, method="BCa", random_state=rng)
    n = x.size; block = min(req.blockLength, n); starts = rng.integers(0, n, size=(req.iterations, int(np.ceil(n / block))))
    offsets = np.arange(block); block_samples = x[(starts[..., None] + offsets) % n].reshape(req.iterations, -1)[:, :n]
    block_statistics = np.apply_along_axis(fn, 1, block_samples)
    jackknife = np.array([fn(np.delete(x, index)) for index in range(n)])
    result: Dict[str, Any] = {"observed": float(fn(x)), "iidBootstrap": {"method": "BCa", "confidenceInterval": [float(bootstrap.confidence_interval.low), float(bootstrap.confidence_interval.high)], "standardError": float(bootstrap.standard_error)},
      "circularBlockBootstrap": {"blockLength": block, "confidenceInterval": _interval(block_statistics, req.confidence), "standardError": float(np.std(block_statistics, ddof=1))},
      "jackknife": {"estimate": float(n * fn(x) - (n - 1) * np.mean(jackknife)), "bias": float((n - 1) * (np.mean(jackknife) - fn(x))), "standardError": float(np.sqrt((n - 1) / n * np.sum((jackknife - np.mean(jackknife)) ** 2)))}}
    if req.group2 is not None:
        y, _ = _finite(req.group2, 5)
        permutation = stats.permutation_test((x, y), lambda a, b: fn(a) - fn(b), permutation_type="independent", alternative="two-sided", n_resamples=req.iterations, random_state=rng)
        result["permutation"] = {"statistic": float(permutation.statistic), "pValue": float(permutation.pvalue), "nullInterval": _interval(permutation.null_distribution, req.confidence)}
    return StatisticsResponse(result=result, diagnostics={"iterations": req.iterations, "seed": req.seed, "confidence": req.confidence, "statistic": req.statistic},
      warnings=["IID bootstrap assumes exchangeability; use the block result for ordered or serially dependent observations."])


class MultipleTestingRequest(BaseModel):
    pValues: List[float] = Field(min_length=2, max_length=10000)
    labels: Optional[List[str]] = Field(default=None, max_length=10000)
    alpha: float = Field(default=0.05, gt=0, lt=0.5)


def multiple_testing(req: MultipleTestingRequest) -> StatisticsResponse:
    from statsmodels.stats.multitest import multipletests
    if any(value < 0 or value > 1 for value in req.pValues): raise ValueError("P-values must be between zero and one.")
    if req.labels is not None and len(req.labels) != len(req.pValues): raise ValueError("Labels and p-values must have equal length.")
    labels = req.labels or [f"H{index + 1}" for index in range(len(req.pValues))]
    methods = {"bonferroni": "bonferroni", "sidak": "sidak", "holm": "holm", "holmSidak": "hs", "benjaminiHochberg": "fdr_bh", "benjaminiYekutieli": "fdr_by"}
    corrections = {}
    for label, method in methods.items():
        reject, adjusted, _, _ = multipletests(req.pValues, alpha=req.alpha, method=method)
        corrections[label] = [{"label": name, "rawPValue": float(raw), "adjustedPValue": float(adj), "reject": bool(decision)} for name, raw, adj, decision in zip(labels, req.pValues, adjusted, reject)]
    return StatisticsResponse(result={"corrections": corrections}, diagnostics={"alpha": req.alpha, "hypotheses": len(req.pValues), "fwerMethods": ["bonferroni", "sidak", "holm", "holmSidak"], "fdrMethods": ["benjaminiHochberg", "benjaminiYekutieli"]},
      warnings=["Choose the correction family before inspecting results; FDR control and family-wise error control answer different questions."])


class MultivariateRequest(BaseModel):
    data: List[List[float]] = Field(min_length=8, max_length=10000)
    featureNames: Optional[List[str]] = Field(default=None, max_length=100)
    nComponents: int = Field(default=2, ge=1, le=25)
    maxClusters: int = Field(default=6, ge=2, le=12)
    seed: int = Field(ge=0, le=2147483647)


def multivariate_structure(req: MultivariateRequest) -> StatisticsResponse:
    from sklearn.cluster import KMeans
    from sklearn.covariance import LedoitWolf
    from sklearn.decomposition import FactorAnalysis, PCA
    from sklearn.metrics import silhouette_score
    matrix = np.asarray(req.data, dtype=float)
    if matrix.ndim != 2 or not np.all(np.isfinite(matrix)): raise ValueError("Data must be a finite rectangular matrix of observation rows.")
    n, p = matrix.shape
    if p < 2 or p > 100 or n <= p: raise ValueError("Use 2-100 features and more observations than features.")
    names = req.featureNames or [f"X{index + 1}" for index in range(p)]
    if len(names) != p: raise ValueError("Feature names must match the matrix columns.")
    standardized = (matrix - matrix.mean(axis=0)) / matrix.std(axis=0, ddof=1)
    if not np.all(np.isfinite(standardized)): raise ValueError("Constant features are not eligible.")
    components = min(req.nComponents, p)
    pca = PCA(n_components=components, svd_solver="full").fit(standardized)
    factors = FactorAnalysis(n_components=components, rotation="varimax", random_state=req.seed).fit(standardized)
    shrinkage = LedoitWolf().fit(standardized)
    correlation = np.corrcoef(standardized, rowvar=False); determinant = max(float(np.linalg.det(correlation)), np.finfo(float).tiny)
    bartlett = -(n - 1 - (2 * p + 5) / 6) * np.log(determinant); bartlett_df = p * (p - 1) // 2
    inverse = np.linalg.pinv(correlation); partial = np.zeros_like(correlation)
    for i in range(p):
        for j in range(p):
            if i != j: partial[i, j] = -inverse[i, j] / np.sqrt(inverse[i, i] * inverse[j, j])
    corr_sq = np.sum(correlation ** 2) - p; partial_sq = np.sum(partial ** 2); kmo = corr_sq / (corr_sq + partial_sq)
    cluster_diagnostics = []
    for k in range(2, min(req.maxClusters, n - 1) + 1):
        labels = KMeans(n_clusters=k, random_state=req.seed, n_init=20).fit_predict(standardized)
        cluster_diagnostics.append({"clusters": k, "silhouette": float(silhouette_score(standardized, labels))})
    return StatisticsResponse(result={"pca": {"explainedVarianceRatio": pca.explained_variance_ratio_.tolist(), "cumulativeExplainedVariance": np.cumsum(pca.explained_variance_ratio_).tolist(), "loadings": {name: pca.components_[:, index].tolist() for index, name in enumerate(names)}},
      "factorAnalysis": {"loadings": {name: factors.components_[:, index].tolist() for index, name in enumerate(names)}, "noiseVariance": factors.noise_variance_.tolist()},
      "covarianceShrinkage": {"method": "Ledoit-Wolf", "shrinkage": float(shrinkage.shrinkage_), "covariance": shrinkage.covariance_.tolist()}, "clustering": cluster_diagnostics},
      diagnostics={"observations": n, "features": p, "components": components, "kmo": float(kmo), "bartlettSphericity": {"statistic": float(bartlett), "degreesOfFreedom": bartlett_df, "pValue": float(stats.chi2.sf(bartlett, bartlett_df))}, "seed": req.seed},
      warnings=[] if kmo >= 0.6 else ["KMO is below 0.60; common-factor structure may be weak or unstable."])


class BayesianNormalRequest(BaseModel):
    data: List[float] = Field(min_length=5, max_length=50000)
    priorMean: float = 0
    priorKappa: float = Field(default=0.01, gt=0)
    priorAlpha: float = Field(default=2, gt=0)
    priorBeta: float = Field(default=1, gt=0)
    confidence: float = Field(default=0.95, gt=0.5, lt=1)
    draws: int = Field(default=4000, ge=1000, le=20000)
    seed: int = Field(ge=0, le=2147483647)


def bayesian_normal(req: BayesianNormalRequest) -> StatisticsResponse:
    x, _ = _finite(req.data, 5); rng = np.random.default_rng(req.seed); n = x.size; mean = np.mean(x)
    kappa = req.priorKappa + n; posterior_mean = (req.priorKappa * req.priorMean + n * mean) / kappa
    alpha = req.priorAlpha + n / 2
    beta = req.priorBeta + 0.5 * np.sum((x - mean) ** 2) + req.priorKappa * n * (mean - req.priorMean) ** 2 / (2 * kappa)
    variance_draws = stats.invgamma.rvs(alpha, scale=beta, size=req.draws, random_state=rng)
    mean_draws = rng.normal(posterior_mean, np.sqrt(variance_draws / kappa))
    predictive = rng.normal(mean_draws, np.sqrt(variance_draws))
    prior_variance = stats.invgamma.rvs(req.priorAlpha, scale=req.priorBeta, size=req.draws, random_state=rng)
    prior_means = rng.normal(req.priorMean, np.sqrt(prior_variance / req.priorKappa))
    prior_predictive = rng.normal(prior_means, np.sqrt(prior_variance))
    chunks = mean_draws[: req.draws - req.draws % 4].reshape(4, -1); chain_means = chunks.mean(axis=1); within = chunks.var(axis=1, ddof=1).mean(); between = chunks.shape[1] * chain_means.var(ddof=1)
    rhat = np.sqrt(((chunks.shape[1] - 1) / chunks.shape[1] * within + between / chunks.shape[1]) / within)
    normal_params = stats.norm.fit(x); t_params = stats.t.fit(x)
    normal_ll = np.sum(stats.norm.logpdf(x, *normal_params)); t_ll = np.sum(stats.t.logpdf(x, *t_params))
    model_comparison = [{"model": "normal", "aic": float(4 - 2 * normal_ll), "bic": float(2 * np.log(n) - 2 * normal_ll)}, {"model": "student_t", "aic": float(6 - 2 * t_ll), "bic": float(3 * np.log(n) - 2 * t_ll)}]
    observed_tail = float(np.mean(np.abs(x - mean) >= 2 * np.std(x, ddof=1)))
    replicated_tail = float(np.mean(np.abs(predictive - np.mean(predictive)) >= 2 * np.std(predictive, ddof=1)))
    return StatisticsResponse(result={"posterior": {"mean": float(np.mean(mean_draws)), "meanCredibleInterval": _interval(mean_draws, req.confidence), "standardDeviation": float(np.mean(np.sqrt(variance_draws))), "standardDeviationCredibleInterval": _interval(np.sqrt(variance_draws), req.confidence)},
      "posteriorPredictive": {"interval": _interval(predictive, req.confidence), "mean": float(np.mean(predictive)), "tailRate": replicated_tail},
      "priorPredictive": {"interval": _interval(prior_predictive, req.confidence), "mean": float(np.mean(prior_predictive))}, "modelComparison": model_comparison},
      diagnostics={"posteriorParameters": {"mean": float(posterior_mean), "kappa": float(kappa), "alpha": float(alpha), "beta": float(beta)}, "splitRHat": float(rhat), "effectiveSampleSize": req.draws, "posteriorPredictiveTailDiscrepancy": abs(observed_tail - replicated_tail), "draws": req.draws, "seed": req.seed},
      warnings=["Conjugate normal inference is sensitive to the stated prior and normal likelihood; inspect prior predictive and Student-t comparison results."])
