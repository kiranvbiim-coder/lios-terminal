"""Bayesian and estimation-error-aware portfolio analytics."""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np
from pydantic import BaseModel, Field
from sklearn.covariance import LedoitWolf


def _unique_assets(assets: List[str], minimum: int = 1) -> None:
    if len(assets) < minimum or len(set(assets)) != len(assets) or any(not a.strip() for a in assets):
        raise ValueError(f"assets must contain at least {minimum} unique non-empty names.")


def _finite_or_none(value: float) -> Optional[float]:
    return float(value) if np.isfinite(value) else None


class BlackLittermanRequest(BaseModel):
    assets: List[str]
    marketWeights: List[float]
    covarianceMatrix: List[List[float]]
    riskAversion: float = Field(gt=0)
    tau: float = Field(default=0.05, gt=0, le=1)
    viewMatrix: List[List[float]]
    viewReturnsPct: List[float]
    viewUncertaintyPct2: Optional[List[float]] = None


class BlackLittermanResponse(BaseModel):
    equilibriumReturnsPct: Dict[str, float]
    posteriorReturnsPct: Dict[str, float]
    posteriorCovariance: List[List[float]]
    viewResidualPct: List[float]


def black_litterman(req: BlackLittermanRequest) -> BlackLittermanResponse:
    _unique_assets(req.assets, 2)
    n = len(req.assets)
    w = np.asarray(req.marketWeights, dtype=float)
    sigma = np.asarray(req.covarianceMatrix, dtype=float)
    P = np.asarray(req.viewMatrix, dtype=float)
    q = np.asarray(req.viewReturnsPct, dtype=float)
    if w.shape != (n,) or sigma.shape != (n, n) or P.ndim != 2 or P.shape[0] < 1 or P.shape[1] != n or q.shape != (P.shape[0],):
        raise ValueError("Black-Litterman dimensions do not align or no views were supplied.")
    if not np.all(np.isfinite(w)) or not np.all(np.isfinite(sigma)) or not np.all(np.isfinite(P)) or not np.all(np.isfinite(q)):
        raise ValueError("Black-Litterman inputs must be finite.")
    if abs(float(w.sum()) - 1) > 1e-6 or np.any(w < 0):
        raise ValueError("marketWeights must be non-negative and sum to 1.")
    if not np.allclose(sigma, sigma.T, atol=1e-10) or float(np.linalg.eigvalsh(sigma).min()) < -1e-8:
        raise ValueError("covarianceMatrix must be symmetric positive semidefinite.")
    pi = req.riskAversion * sigma @ w
    tau_sigma = req.tau * sigma
    if req.viewUncertaintyPct2 is None:
        omega = np.diag(np.maximum(np.diag(P @ tau_sigma @ P.T), 1e-12))
    else:
        uncertainty = np.asarray(req.viewUncertaintyPct2, dtype=float)
        if uncertainty.shape != (P.shape[0],) or np.any(uncertainty <= 0) or not np.all(np.isfinite(uncertainty)):
            raise ValueError("viewUncertaintyPct2 must contain one finite positive value per view.")
        omega = np.diag(uncertainty)
    middle = np.linalg.pinv(P @ tau_sigma @ P.T + omega)
    posterior_mu = pi + tau_sigma @ P.T @ middle @ (q - P @ pi)
    posterior_cov = sigma + tau_sigma - tau_sigma @ P.T @ middle @ P @ tau_sigma
    posterior_cov = 0.5 * (posterior_cov + posterior_cov.T)
    if not np.all(np.isfinite(posterior_mu)) or not np.all(np.isfinite(posterior_cov)):
        raise ValueError("Black-Litterman posterior is non-finite under supplied assumptions.")
    return BlackLittermanResponse(
        equilibriumReturnsPct={a: float(x) for a, x in zip(req.assets, pi)},
        posteriorReturnsPct={a: float(x) for a, x in zip(req.assets, posterior_mu)},
        posteriorCovariance=posterior_cov.tolist(),
        viewResidualPct=list(map(float, q - P @ posterior_mu)),
    )


class BayesianMeanShrinkageRequest(BaseModel):
    assets: List[str]
    sampleMeanReturnsPct: List[float]
    standardErrorsPct: List[float]
    priorMeanReturnsPct: Optional[List[float]] = None
    priorStdPct: float = Field(default=5.0, gt=0)


class BayesianMeanShrinkageResponse(BaseModel):
    posteriorMeanReturnsPct: Dict[str, float]
    posteriorStdPct: Dict[str, float]
    dataWeights: Dict[str, float]


def bayesian_mean_shrinkage(req: BayesianMeanShrinkageRequest) -> BayesianMeanShrinkageResponse:
    _unique_assets(req.assets)
    n = len(req.assets)
    sample = np.asarray(req.sampleMeanReturnsPct, dtype=float)
    se = np.asarray(req.standardErrorsPct, dtype=float)
    prior = np.asarray(req.priorMeanReturnsPct if req.priorMeanReturnsPct is not None else [float(sample.mean())] * n, dtype=float)
    if sample.shape != (n,) or se.shape != (n,) or prior.shape != (n,) or np.any(se <= 0):
        raise ValueError("Mean, standard-error and prior arrays must match assets; standard errors must be positive.")
    if not np.all(np.isfinite(sample)) or not np.all(np.isfinite(se)) or not np.all(np.isfinite(prior)):
        raise ValueError("Bayesian mean-shrinkage inputs must be finite.")
    sample_precision = 1.0 / (se ** 2)
    prior_precision = 1.0 / (req.priorStdPct ** 2)
    total_precision = sample_precision + prior_precision
    posterior = (sample_precision * sample + prior_precision * prior) / total_precision
    posterior_std = np.sqrt(1.0 / total_precision)
    data_weight = sample_precision / total_precision
    return BayesianMeanShrinkageResponse(
        posteriorMeanReturnsPct={a: float(v) for a, v in zip(req.assets, posterior)},
        posteriorStdPct={a: float(v) for a, v in zip(req.assets, posterior_std)},
        dataWeights={a: float(v) for a, v in zip(req.assets, data_weight)},
    )


class RobustCovarianceRequest(BaseModel):
    assets: List[str]
    returnsMatrixPct: List[List[float]]


class RobustCovarianceResponse(BaseModel):
    covarianceMatrixPct2: List[List[float]]
    sampleCovarianceMatrixPct2: List[List[float]]
    shrinkageIntensity: float
    conditionNumberSample: Optional[float]
    conditionNumberShrunk: Optional[float]


def ledoit_wolf_covariance(req: RobustCovarianceRequest) -> RobustCovarianceResponse:
    _unique_assets(req.assets, 2)
    X = np.asarray(req.returnsMatrixPct, dtype=float)
    if X.ndim != 2 or X.shape[1] != len(req.assets) or X.shape[0] < max(20, len(req.assets) + 2) or not np.all(np.isfinite(X)):
        raise ValueError("returnsMatrixPct requires sufficient finite observations with one column per asset.")
    if np.any(np.std(X, axis=0, ddof=1) <= 1e-15):
        raise ValueError("Each asset requires non-zero return variation for covariance estimation.")
    sample = np.asarray(np.cov(X, rowvar=False, ddof=1), dtype=float)
    estimator = LedoitWolf().fit(X)
    shrunk = np.asarray(estimator.covariance_, dtype=float)
    if sample.shape != (len(req.assets), len(req.assets)) or shrunk.shape != sample.shape:
        raise ValueError("Covariance estimator returned an unexpected matrix shape.")
    return RobustCovarianceResponse(
        covarianceMatrixPct2=shrunk.tolist(),
        sampleCovarianceMatrixPct2=sample.tolist(),
        shrinkageIntensity=float(estimator.shrinkage_),
        conditionNumberSample=_finite_or_none(float(np.linalg.cond(sample))),
        conditionNumberShrunk=_finite_or_none(float(np.linalg.cond(shrunk))),
    )
