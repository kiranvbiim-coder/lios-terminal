"""
Fixed-income pricing backed by QuantLib.

The simple request path remains backward compatible, but institutional callers
can now pin the valuation date, exact maturity, seasoned-bond schedule start,
settlement convention, calendar and redemption value.  The response also
contains an independent bump-and-reprice duration/convexity cross-check so a
material result is not trusted solely because one analytical formula returned.
"""

from typing import Literal, Optional

import QuantLib as ql
from pydantic import BaseModel, Field

DAY_COUNT_MAP = {
    "30/360": ql.Thirty360(ql.Thirty360.BondBasis),
    "ACT/ACT": ql.ActualActual(ql.ActualActual.Bond),
    "ACT/360": ql.Actual360(),
    "ACT/365": ql.Actual365Fixed(),
}

FREQUENCY_MAP = {1: ql.Annual, 2: ql.Semiannual, 4: ql.Quarterly, 12: ql.Monthly}
BUSINESS_DAY_MAP = {
    "UNADJUSTED": ql.Unadjusted,
    "FOLLOWING": ql.Following,
    "MODIFIED_FOLLOWING": ql.ModifiedFollowing,
    "PRECEDING": ql.Preceding,
}


def _calendar(name: str):
    if name == "TARGET":
        return ql.TARGET()
    if name == "US_GOVT":
        return ql.UnitedStates(ql.UnitedStates.GovernmentBond)
    if name == "UK_EXCHANGE":
        return ql.UnitedKingdom(ql.UnitedKingdom.Exchange)
    return ql.NullCalendar()


def _parse_iso_date(value: Optional[str], label: str) -> Optional[ql.Date]:
    if value is None:
        return None
    try:
        parsed = ql.DateParser.parseISO(value)
    except Exception as exc:  # noqa: BLE001 -- convert library parsing failure to stable validation error
        raise ValueError(f"{label} must be an ISO date in YYYY-MM-DD format") from exc
    if parsed == ql.Date():
        raise ValueError(f"{label} must be a valid ISO date in YYYY-MM-DD format")
    return parsed


class BondPriceRequest(BaseModel):
    faceValue: float = Field(gt=0)
    couponRatePct: float = Field(ge=0, le=100)
    frequency: Literal[1, 2, 4, 12] = 2
    yearsToMaturity: float = Field(gt=0, le=100)
    marketYieldPct: float = Field(ge=-5, le=100)
    dayCount: Literal["30/360", "ACT/ACT", "ACT/360", "ACT/365"] = "30/360"

    valuationDate: Optional[str] = None
    maturityDate: Optional[str] = None
    scheduleStartDate: Optional[str] = None
    settlementDays: int = Field(default=0, ge=0, le=10)
    redemptionPct: float = Field(default=100.0, gt=0, le=500)
    calendar: Literal["NULL", "TARGET", "US_GOVT", "UK_EXCHANGE"] = "NULL"
    businessDayConvention: Literal[
        "UNADJUSTED", "FOLLOWING", "MODIFIED_FOLLOWING", "PRECEDING"
    ] = "UNADJUSTED"


class BondPriceResponse(BaseModel):
    cleanPricePct: float
    dirtyPricePct: float
    accruedInterestPct: float
    cleanPriceAmount: float
    dirtyPriceAmount: float
    accruedInterestAmount: float
    macaulayDuration: float
    modifiedDuration: float
    convexityValue: float
    dv01Amount: float

    effectiveDuration: float
    effectiveConvexity: float
    priceDown1bpPct: float
    priceUp1bpPct: float
    durationCrossCheckAbs: float
    convexityCrossCheckRelativeError: float

    valuationDateUsed: str
    settlementDateUsed: str
    scheduleStartDateUsed: str
    maturityDate: str
    dayCountUsed: str
    calendarUsed: str
    businessDayConventionUsed: str
    settlementDaysUsed: int
    redemptionPctUsed: float


def _clean_price_at_yield(bond: ql.FixedRateBond, annual_yield: float, day_count, frequency_enum) -> float:
    rate = ql.InterestRate(annual_yield, day_count, ql.Compounded, frequency_enum)
    return ql.BondFunctions.cleanPrice(bond, rate)


def price_bond(req: BondPriceRequest) -> BondPriceResponse:
    calendar = _calendar(req.calendar)
    valuation_date = _parse_iso_date(req.valuationDate, "valuationDate") or ql.Date.todaysDate()
    ql.Settings.instance().evaluationDate = valuation_date

    day_count = DAY_COUNT_MAP[req.dayCount]
    frequency_enum = FREQUENCY_MAP[req.frequency]
    business_day = BUSINESS_DAY_MAP[req.businessDayConvention]

    exact_maturity = _parse_iso_date(req.maturityDate, "maturityDate")
    maturity_date = exact_maturity or calendar.advance(
        valuation_date,
        ql.Period(int(round(req.yearsToMaturity * 12)), ql.Months),
        business_day,
        False,
    )
    schedule_start = _parse_iso_date(req.scheduleStartDate, "scheduleStartDate") or valuation_date

    if maturity_date <= valuation_date:
        raise ValueError("maturityDate must be after valuationDate")
    if schedule_start >= maturity_date:
        raise ValueError("scheduleStartDate must be before maturityDate")

    schedule = ql.Schedule(
        schedule_start,
        maturity_date,
        ql.Period(frequency_enum),
        calendar,
        business_day,
        business_day,
        ql.DateGeneration.Backward,
        False,
    )

    bond = ql.FixedRateBond(
        req.settlementDays,
        req.faceValue,
        schedule,
        [req.couponRatePct / 100.0],
        day_count,
        business_day,
        req.redemptionPct,
    )

    market_yield = req.marketYieldPct / 100.0
    yield_quote = ql.InterestRate(market_yield, day_count, ql.Compounded, frequency_enum)

    clean_price = ql.BondFunctions.cleanPrice(bond, yield_quote)
    accrued = ql.BondFunctions.accruedAmount(bond)
    dirty_price = clean_price + accrued
    macaulay = ql.BondFunctions.duration(bond, yield_quote, ql.Duration.Macaulay)
    modified = ql.BondFunctions.duration(bond, yield_quote, ql.Duration.Modified)
    convexity = ql.BondFunctions.convexity(bond, yield_quote)

    # QuantLib's analytical duration/convexity normalize by the full (dirty)
    # economic value of the remaining cashflows. Accrued interest does not move
    # with yield, but it *does* belong in the denominator of that definition.
    # Using clean price here creates an artificial discrepancy for seasoned
    # bonds, so the independent finite-difference check is performed on dirty
    # value while the quoted bumped prices remain clean-price quotes.
    dy = 0.0001
    price_down = _clean_price_at_yield(bond, market_yield - dy, day_count, frequency_enum)
    price_up = _clean_price_at_yield(bond, market_yield + dy, day_count, frequency_enum)
    dirty_down = price_down + accrued
    dirty_up = price_up + accrued
    effective_duration = (dirty_down - dirty_up) / (2.0 * dirty_price * dy)
    effective_convexity = (dirty_down + dirty_up - 2.0 * dirty_price) / (dirty_price * dy * dy)

    duration_error = abs(effective_duration - modified)
    convexity_denominator = max(abs(convexity), 1e-12)
    convexity_relative_error = abs(effective_convexity - convexity) / convexity_denominator

    # Central bump DV01 is invariant to accrued interest because accrued is
    # yield-independent, so the clean-price bump is the correct quoted change.
    scale = req.faceValue / 100.0
    dv01_pct = (price_down - price_up) / 2.0

    return BondPriceResponse(
        cleanPricePct=clean_price,
        dirtyPricePct=dirty_price,
        accruedInterestPct=accrued,
        cleanPriceAmount=clean_price * scale,
        dirtyPriceAmount=dirty_price * scale,
        accruedInterestAmount=accrued * scale,
        macaulayDuration=macaulay,
        modifiedDuration=modified,
        convexityValue=convexity,
        dv01Amount=dv01_pct * scale,
        effectiveDuration=effective_duration,
        effectiveConvexity=effective_convexity,
        priceDown1bpPct=price_down,
        priceUp1bpPct=price_up,
        durationCrossCheckAbs=duration_error,
        convexityCrossCheckRelativeError=convexity_relative_error,
        valuationDateUsed=valuation_date.ISO(),
        settlementDateUsed=bond.settlementDate().ISO(),
        scheduleStartDateUsed=schedule_start.ISO(),
        maturityDate=maturity_date.ISO(),
        dayCountUsed=req.dayCount,
        calendarUsed=req.calendar,
        businessDayConventionUsed=req.businessDayConvention,
        settlementDaysUsed=req.settlementDays,
        redemptionPctUsed=req.redemptionPct,
    )
