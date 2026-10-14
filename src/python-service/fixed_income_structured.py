"""Structured fixed-income analytics extending the base bond/curve engines."""
from __future__ import annotations

from math import exp, sqrt
from typing import Dict, List

import numpy as np
from pydantic import BaseModel, Field
from scipy import optimize


class CallPoint(BaseModel):
    year: float = Field(gt=0)
    callPricePct: float = Field(gt=0)


class CallableBondOasRequest(BaseModel):
    faceValue: float = Field(default=100.0, gt=0)
    couponRatePct: float = Field(ge=0)
    maturityYears: float = Field(gt=0, le=50)
    frequency: int = Field(default=2, ge=1, le=12)
    flatRiskFreeRatePct: float
    shortRateVolatilityPct: float = Field(default=1.0, ge=0, le=50)
    marketPrice: float = Field(gt=0)
    callSchedule: List[CallPoint] = Field(default_factory=list)


class CallableBondOasResponse(BaseModel):
    optionAdjustedSpreadBps: float
    modelPriceAtOas: float
    optionFreePriceAtOas: float
    embeddedCallValue: float
    effectiveDurationYears: float
    effectiveConvexity: float
    oasSpreadDurationYears: float
    oasSpreadConvexity: float


def _callable_tree_price(
    req: CallableBondOasRequest,
    spread: float,
    honor_calls: bool = True,
    rate_shift: float = 0.0,
) -> float:
    n = int(round(req.maturityYears * req.frequency))
    if n < 1 or abs(n / req.frequency - req.maturityYears) > 1e-8:
        raise ValueError("maturityYears must align to frequency.")
    dt = 1.0 / req.frequency
    coupon = req.faceValue * req.couponRatePct / 100.0 / req.frequency
    base_rate = req.flatRiskFreeRatePct / 100.0 + rate_shift
    sigma = req.shortRateVolatilityPct / 100.0
    calls: Dict[int, float] = {}
    for point in req.callSchedule:
        step = int(round(point.year * req.frequency))
        if step <= 0 or step >= n or abs(step / req.frequency - point.year) > 1e-8:
            raise ValueError("Call dates must align to coupon dates before maturity.")
        calls[step] = req.faceValue * point.callPricePct / 100.0

    values = np.full(n + 1, req.faceValue + coupon, dtype=float)
    for step in range(n - 1, -1, -1):
        next_values = values
        values = np.empty(step + 1, dtype=float)
        for up_moves in range(step + 1):
            short_rate = base_rate + (2 * up_moves - step) * sigma * sqrt(dt)
            exponent = -(short_rate + spread) * dt
            if exponent > 700:
                raise ValueError("Rate/spread assumptions produce numerically unstable discount factors.")
            continuation = exp(exponent) * 0.5 * (next_values[up_moves] + next_values[up_moves + 1])
            value = continuation + (coupon if step > 0 else 0.0)
            if honor_calls and step in calls:
                value = min(value, calls[step] + coupon)
            values[up_moves] = value
    price = float(values[0])
    if not np.isfinite(price) or price <= 0:
        raise ValueError("Callable-bond tree produced a non-finite or non-positive price.")
    return price


def callable_bond_oas(req: CallableBondOasRequest) -> CallableBondOasResponse:
    def error(spread: float) -> float:
        return _callable_tree_price(req, spread, True) - req.marketPrice

    lo, hi = -0.20, 2.0
    lo_error, hi_error = error(lo), error(hi)
    if lo_error * hi_error > 0:
        raise ValueError("Unable to bracket OAS for supplied price and assumptions.")
    oas = float(optimize.brentq(error, lo, hi, xtol=1e-12))
    price = _callable_tree_price(req, oas, True)
    option_free = _callable_tree_price(req, oas, False)
    bump = 1e-4

    # Effective duration/convexity: parallel risk-free curve bump with OAS held constant.
    rate_down = _callable_tree_price(req, oas, True, rate_shift=-bump)
    rate_up = _callable_tree_price(req, oas, True, rate_shift=bump)
    effective_duration = (rate_down - rate_up) / (2 * price * bump)
    effective_convexity = (rate_down + rate_up - 2 * price) / (price * bump * bump)

    # OAS spread duration/convexity: spread bump with the risk-free curve held constant.
    spread_down = _callable_tree_price(req, oas - bump, True)
    spread_up = _callable_tree_price(req, oas + bump, True)
    spread_duration = (spread_down - spread_up) / (2 * price * bump)
    spread_convexity = (spread_down + spread_up - 2 * price) / (price * bump * bump)

    return CallableBondOasResponse(
        optionAdjustedSpreadBps=oas * 10000.0,
        modelPriceAtOas=price,
        optionFreePriceAtOas=option_free,
        embeddedCallValue=max(0.0, option_free - price),
        effectiveDurationYears=float(effective_duration),
        effectiveConvexity=float(effective_convexity),
        oasSpreadDurationYears=float(spread_duration),
        oasSpreadConvexity=float(spread_convexity),
    )


class FloatingRateNoteRequest(BaseModel):
    faceValue: float = Field(default=100.0, gt=0)
    referenceRatePct: float
    quotedMarginBps: float = 0.0
    discountMarginBps: float = 0.0
    maturityYears: float = Field(gt=0, le=50)
    frequency: int = Field(default=4, ge=1, le=12)


class FloatingRateNoteResponse(BaseModel):
    price: float
    currentCouponPct: float
    discountMarginBps: float
    effectiveDurationYears: float
    dv01: float
    discountMarginDurationYears: float
    dm01: float


def floating_rate_note(req: FloatingRateNoteRequest) -> FloatingRateNoteResponse:
    n = int(round(req.maturityYears * req.frequency))
    if n < 1 or abs(n / req.frequency - req.maturityYears) > 1e-8:
        raise ValueError("maturityYears must align to frequency.")
    dt = 1 / req.frequency
    base_reference = req.referenceRatePct / 100.0
    quoted_margin = req.quotedMarginBps / 10000.0
    discount_margin = req.discountMarginBps / 10000.0

    def price(reference_shift: float = 0.0, margin_shift: float = 0.0) -> float:
        coupon_rate = base_reference + reference_shift + quoted_margin
        discount_rate = base_reference + reference_shift + discount_margin + margin_shift
        if 1 + discount_rate * dt <= 0:
            raise ValueError("FRN assumptions imply a non-positive periodic discount denominator.")
        pv = 0.0
        for k in range(1, n + 1):
            cf = req.faceValue * coupon_rate * dt + (req.faceValue if k == n else 0.0)
            pv += cf / ((1 + discount_rate * dt) ** k)
        return float(pv)

    p0 = price()
    if not np.isfinite(p0) or p0 <= 0:
        raise ValueError("FRN assumptions produced a non-finite or non-positive price.")
    bump = 1e-4

    # Parallel reference-rate shock: coupon and discount reference rate reset together.
    ref_down, ref_up = price(reference_shift=-bump), price(reference_shift=bump)
    effective_duration = (ref_down - ref_up) / (2 * p0 * bump)
    dv01 = (ref_down - ref_up) / 2.0

    # Discount-margin shock: coupon stays unchanged; only required margin changes.
    dm_down, dm_up = price(margin_shift=-bump), price(margin_shift=bump)
    dm_duration = (dm_down - dm_up) / (2 * p0 * bump)
    dm01 = (dm_down - dm_up) / 2.0

    return FloatingRateNoteResponse(
        price=p0,
        currentCouponPct=(base_reference + quoted_margin) * 100.0,
        discountMarginBps=req.discountMarginBps,
        effectiveDurationYears=float(effective_duration),
        dv01=float(dv01),
        discountMarginDurationYears=float(dm_duration),
        dm01=float(dm01),
    )


class InflationLinkedBondRequest(BaseModel):
    faceValue: float = Field(default=100.0, gt=0)
    realCouponRatePct: float = Field(ge=0)
    realYieldPct: float
    maturityYears: float = Field(gt=0, le=50)
    frequency: int = Field(default=2, ge=1, le=12)
    baseIndex: float = Field(gt=0)
    currentIndex: float = Field(gt=0)
    expectedInflationPct: float


class InflationLinkedBondResponse(BaseModel):
    realPrice: float
    indexedNominalPrice: float
    currentIndexRatio: float
    projectedMaturityIndexRatio: float
    projectedMaturityPrincipal: float


def inflation_linked_bond(req: InflationLinkedBondRequest) -> InflationLinkedBondResponse:
    n = int(round(req.maturityYears * req.frequency))
    if n < 1 or abs(n / req.frequency - req.maturityYears) > 1e-8:
        raise ValueError("maturityYears must align to frequency.")
    dt = 1 / req.frequency
    real_yield = req.realYieldPct / 100.0
    real_coupon = req.realCouponRatePct / 100.0
    if 1 + real_yield * dt <= 0:
        raise ValueError("Real yield implies a non-positive periodic discount denominator.")
    real_price = 0.0
    for k in range(1, n + 1):
        cf = req.faceValue * real_coupon * dt + (req.faceValue if k == n else 0.0)
        real_price += cf / ((1 + real_yield * dt) ** k)
    current_ratio = req.currentIndex / req.baseIndex
    inflation_base = 1 + req.expectedInflationPct / 100.0
    if inflation_base <= 0:
        raise ValueError("Expected inflation must be greater than -100%.")
    maturity_ratio = current_ratio * (inflation_base ** req.maturityYears)
    return InflationLinkedBondResponse(
        realPrice=float(real_price),
        indexedNominalPrice=float(real_price * current_ratio),
        currentIndexRatio=float(current_ratio),
        projectedMaturityIndexRatio=float(maturity_ratio),
        projectedMaturityPrincipal=float(req.faceValue * maturity_ratio),
    )


class CreditSpreadCurveRequest(BaseModel):
    maturitiesYears: List[float]
    spreadsBps: List[float]
    recoveryRatePct: float = Field(default=40.0, ge=0, lt=100)
    queryMaturitiesYears: List[float]


class CreditSpreadCurveResponse(BaseModel):
    interpolatedSpreadsBps: List[float]
    impliedHazardRatesPct: List[float]
    survivalProbabilitiesPct: List[float]


def credit_spread_curve(req: CreditSpreadCurveRequest) -> CreditSpreadCurveResponse:
    t = np.asarray(req.maturitiesYears, dtype=float)
    s = np.asarray(req.spreadsBps, dtype=float)
    q = np.asarray(req.queryMaturitiesYears, dtype=float)
    if len(t) < 2 or s.shape != t.shape or np.any(t <= 0) or np.any(np.diff(t) <= 0) or np.any(s < 0) or np.any(q <= 0):
        raise ValueError("Spread curve requires increasing positive maturities, non-negative spreads and positive query maturities.")
    if not np.all(np.isfinite(t)) or not np.all(np.isfinite(s)) or not np.all(np.isfinite(q)):
        raise ValueError("Spread-curve inputs must be finite.")
    interp = np.interp(q, t, s, left=s[0], right=s[-1])
    loss_given_default = 1 - req.recoveryRatePct / 100.0
    hazard = interp / 10000.0 / loss_given_default
    survival = np.exp(-hazard * q)
    return CreditSpreadCurveResponse(
        interpolatedSpreadsBps=list(map(float, interp)),
        impliedHazardRatesPct=list(map(float, hazard * 100.0)),
        survivalProbabilitiesPct=list(map(float, survival * 100.0)),
    )
