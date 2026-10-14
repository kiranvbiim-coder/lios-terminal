"""Institutional fixed-income analytics built on transparent cash-flow math.

These routines complement the QuantLib single-bond endpoint with curve construction,
spread analytics, key-rate risk and immunisation. Inputs are explicit and deterministic;
no market data is fetched inside this module.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np
from pydantic import BaseModel, Field
from scipy import optimize


class CurveNode(BaseModel):
    maturityYears: float = Field(gt=0)
    zeroRatePct: float


class BootstrapCurveRequest(BaseModel):
    maturitiesYears: List[float]
    parYieldsPct: List[float]
    frequency: int = Field(default=2, ge=1, le=12)


class BootstrapCurveResponse(BaseModel):
    nodes: List[CurveNode]
    discountFactors: List[float]
    forwardRatesPct: List[float]


def _validate_curve_times(times: np.ndarray) -> None:
    if times.ndim != 1 or len(times) == 0 or not np.all(np.isfinite(times)):
        raise ValueError("Curve maturities must be a finite non-empty vector.")
    if np.any(times <= 0) or np.any(np.diff(times) <= 0):
        raise ValueError("Curve maturities must be strictly increasing and positive.")


def bootstrap_par_curve(req: BootstrapCurveRequest) -> BootstrapCurveResponse:
    times = np.asarray(req.maturitiesYears, dtype=float)
    yields = np.asarray(req.parYieldsPct, dtype=float) / 100.0
    _validate_curve_times(times)
    if yields.shape != times.shape or not np.all(np.isfinite(yields)):
        raise ValueError("parYieldsPct must contain one finite value per maturity.")

    freq = int(req.frequency)
    dfs: List[float] = []
    zero_rates: List[float] = []
    for i, (t, y) in enumerate(zip(times, yields)):
        periods = int(round(t * freq))
        if periods <= 0 or abs(periods / freq - t) > 1e-8:
            raise ValueError("Par-curve maturities must align to the stated coupon frequency.")
        coupon = y / freq
        if i == 0 and periods != 1:
            raise ValueError("Bootstrap curve must begin at the first coupon period.")
        if periods != i + 1:
            raise ValueError("Bootstrap curve must include every coupon-period maturity without gaps.")
        prior_coupon_pv = coupon * sum(dfs)
        df = (1.0 - prior_coupon_pv) / (1.0 + coupon)
        if not np.isfinite(df) or df <= 0:
            raise ValueError("Par yields imply a non-positive discount factor.")
        dfs.append(float(df))
        zero_rates.append(float(-np.log(df) / t))

    forwards = [zero_rates[0]]
    for i in range(1, len(times)):
        dt = times[i] - times[i - 1]
        forwards.append(float(-np.log(dfs[i] / dfs[i - 1]) / dt))

    return BootstrapCurveResponse(
        nodes=[CurveNode(maturityYears=float(t), zeroRatePct=float(r * 100.0)) for t, r in zip(times, zero_rates)],
        discountFactors=dfs,
        forwardRatesPct=[float(f * 100.0) for f in forwards],
    )


class CashFlow(BaseModel):
    timeYears: float = Field(gt=0)
    amount: float


class SpreadAnalyticsRequest(BaseModel):
    cashFlows: List[CashFlow]
    curve: List[CurveNode]
    marketPrice: float = Field(gt=0)


class SpreadAnalyticsResponse(BaseModel):
    zSpreadBps: float
    spreadDurationYears: float
    dv01: float
    modelPrice: float


def _interp_zero(curve: List[CurveNode], t: float) -> float:
    times = np.array([n.maturityYears for n in curve], dtype=float)
    rates = np.array([n.zeroRatePct for n in curve], dtype=float) / 100.0
    _validate_curve_times(times)
    if not np.all(np.isfinite(rates)):
        raise ValueError("Curve rates must be finite.")
    return float(np.interp(t, times, rates, left=rates[0], right=rates[-1]))


def _price_cashflows(cashflows: List[CashFlow], curve: List[CurveNode], spread: float = 0.0) -> float:
    return float(sum(cf.amount * np.exp(-(_interp_zero(curve, cf.timeYears) + spread) * cf.timeYears) for cf in cashflows))


def spread_analytics(req: SpreadAnalyticsRequest) -> SpreadAnalyticsResponse:
    if not req.cashFlows:
        raise ValueError("At least one cash flow is required.")
    if not np.isfinite(req.marketPrice) or not all(np.isfinite(cf.amount) for cf in req.cashFlows):
        raise ValueError("Market price and cash-flow amounts must be finite.")
    base_price = _price_cashflows(req.cashFlows, req.curve)

    def objective(spread: float) -> float:
        return _price_cashflows(req.cashFlows, req.curve, spread) - req.marketPrice

    lo, hi = -0.5, 5.0
    if objective(lo) * objective(hi) > 0:
        raise ValueError("Unable to bracket a z-spread for the supplied price and cash flows.")
    z = float(optimize.brentq(objective, lo, hi, xtol=1e-13))
    p0 = _price_cashflows(req.cashFlows, req.curve, z)
    bump = 1e-4
    p_down = _price_cashflows(req.cashFlows, req.curve, z - bump)
    p_up = _price_cashflows(req.cashFlows, req.curve, z + bump)
    duration = (p_down - p_up) / (2.0 * p0 * bump)
    dv01 = (p_down - p_up) / 2.0
    return SpreadAnalyticsResponse(
        zSpreadBps=z * 10000.0,
        spreadDurationYears=float(duration),
        dv01=float(dv01),
        modelPrice=float(base_price),
    )


class KeyRateRiskRequest(BaseModel):
    cashFlows: List[CashFlow]
    curve: List[CurveNode]
    keyMaturitiesYears: List[float]
    bumpBps: float = Field(default=1.0, gt=0, le=100)


class KeyRateRiskResponse(BaseModel):
    basePrice: float
    parallelDurationYears: float
    keyRateDurations: Dict[str, float]
    keyRateDv01: Dict[str, float]


def key_rate_risk(req: KeyRateRiskRequest) -> KeyRateRiskResponse:
    if not req.keyMaturitiesYears:
        raise ValueError("At least one key maturity is required.")
    key_maturities = np.asarray(req.keyMaturitiesYears, dtype=float)
    if not np.all(np.isfinite(key_maturities)):
        raise ValueError("Key maturities must be finite.")
    base = _price_cashflows(req.cashFlows, req.curve)
    if base <= 0:
        raise ValueError("Cash-flow price must be positive.")
    bump = req.bumpBps / 10000.0
    krd: Dict[str, float] = {}
    dv01: Dict[str, float] = {}

    node_times = np.array([n.maturityYears for n in req.curve], dtype=float)
    _validate_curve_times(node_times)
    for key in req.keyMaturitiesYears:
        if key <= 0:
            raise ValueError("Key maturities must be positive.")
        widths = np.maximum(np.diff(np.r_[0.0, req.keyMaturitiesYears]), 0.25)
        width = float(np.median(widths))

        def bumped(sign: float) -> List[CurveNode]:
            nodes = []
            for node in req.curve:
                distance = abs(node.maturityYears - key)
                weight = max(0.0, 1.0 - distance / max(width, 1e-9))
                nodes.append(CurveNode(maturityYears=node.maturityYears, zeroRatePct=node.zeroRatePct + sign * weight * req.bumpBps / 100.0))
            return nodes

        p_down = _price_cashflows(req.cashFlows, bumped(-1.0))
        p_up = _price_cashflows(req.cashFlows, bumped(1.0))
        label = f"{key:g}Y"
        krd[label] = float((p_down - p_up) / (2.0 * base * bump))
        dv01[label] = float((p_down - p_up) / 2.0)

    parallel_down = [CurveNode(maturityYears=n.maturityYears, zeroRatePct=n.zeroRatePct - req.bumpBps / 100.0) for n in req.curve]
    parallel_up = [CurveNode(maturityYears=n.maturityYears, zeroRatePct=n.zeroRatePct + req.bumpBps / 100.0) for n in req.curve]
    parallel_duration = (_price_cashflows(req.cashFlows, parallel_down) - _price_cashflows(req.cashFlows, parallel_up)) / (2.0 * base * bump)
    return KeyRateRiskResponse(basePrice=base, parallelDurationYears=float(parallel_duration), keyRateDurations=krd, keyRateDv01=dv01)


class ImmunizationAsset(BaseModel):
    name: str
    price: float = Field(gt=0)
    durationYears: float = Field(ge=0)


class ImmunizationRequest(BaseModel):
    assets: List[ImmunizationAsset]
    targetDurationYears: float = Field(ge=0)


class ImmunizationResponse(BaseModel):
    weights: Dict[str, float]
    achievedDurationYears: float


def immunize_duration(req: ImmunizationRequest) -> ImmunizationResponse:
    if len(req.assets) < 2:
        raise ValueError("At least two assets are required for immunisation.")
    names = [asset.name for asset in req.assets]
    if len(set(names)) != len(names):
        raise ValueError("Immunisation asset names must be unique.")
    durations = np.array([a.durationYears for a in req.assets], dtype=float)
    if not np.all(np.isfinite(durations)) or not np.isfinite(req.targetDurationYears):
        raise ValueError("Immunisation durations and target duration must be finite.")
    n = len(durations)
    res = optimize.minimize(
        lambda w: float(np.sum((w - 1.0 / n) ** 2)),
        np.ones(n) / n,
        method="SLSQP",
        bounds=[(0.0, 1.0)] * n,
        constraints=[
            {"type": "eq", "fun": lambda w: float(np.sum(w) - 1.0)},
            {"type": "eq", "fun": lambda w: float(w @ durations - req.targetDurationYears)},
        ],
    )
    if not res.success:
        raise ValueError(f"Duration target is infeasible: {res.message}")
    return ImmunizationResponse(
        weights={asset.name: float(w) for asset, w in zip(req.assets, res.x)},
        achievedDurationYears=float(res.x @ durations),
    )
