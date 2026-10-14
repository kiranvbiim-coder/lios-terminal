"""Specialised valuation engines for projects, options, SaaS cohorts and insurers."""
from __future__ import annotations

from math import erf, exp, log, sqrt
from typing import Dict, List, Literal, Optional

import numpy as np
from pydantic import BaseModel, Field

from advanced_valuation import _dcf_value


def _cdf(x: float) -> float:
    return 0.5 * (1.0 + erf(x / sqrt(2.0)))


class RealOptionRequest(BaseModel):
    underlyingProjectValue: float = Field(gt=0)
    exerciseInvestment: float = Field(gt=0)
    timeToDecisionYears: float = Field(gt=0)
    riskFreeRatePct: float
    volatilityPct: float = Field(gt=0)
    dividendOrDelayCostPct: float = 0.0
    optionType: Literal["expand", "defer", "call", "abandon", "put"] = "expand"


class RealOptionResponse(BaseModel):
    optionValue: float
    immediateExerciseValue: float
    timeValue: float
    d1: float
    d2: float


def real_option_value(req: RealOptionRequest) -> RealOptionResponse:
    s, k, t = req.underlyingProjectValue, req.exerciseInvestment, req.timeToDecisionYears
    r, q, sigma = req.riskFreeRatePct / 100.0, req.dividendOrDelayCostPct / 100.0, req.volatilityPct / 100.0
    d1 = (log(s / k) + (r - q + 0.5 * sigma * sigma) * t) / (sigma * sqrt(t))
    d2 = d1 - sigma * sqrt(t)
    if req.optionType in {"expand", "defer", "call"}:
        value = s * exp(-q * t) * _cdf(d1) - k * exp(-r * t) * _cdf(d2)
        immediate = max(0.0, s - k)
    else:
        value = k * exp(-r * t) * _cdf(-d2) - s * exp(-q * t) * _cdf(-d1)
        immediate = max(0.0, k - s)
    return RealOptionResponse(optionValue=value, immediateExerciseValue=immediate, timeValue=value - immediate, d1=d1, d2=d2)


class DcfExpectationSurfaceRequest(BaseModel):
    currentRevenue: float = Field(gt=0)
    netDebt: float = 0.0
    sharesOutstanding: float = Field(gt=0)
    years: int = Field(default=5, ge=1, le=20)
    waccPct: float = Field(gt=0)
    terminalGrowthPct: float
    taxRatePct: float = Field(ge=0, le=100)
    reinvestmentPctOfRevenue: float = Field(ge=0)
    revenueGrowthGridPct: List[float]
    ebitMarginGridPct: List[float]


class DcfExpectationSurfaceResponse(BaseModel):
    growthGridPct: List[float]
    marginGridPct: List[float]
    valuePerShareMatrix: List[List[float]]
    minimumValuePerShare: float
    maximumValuePerShare: float


def dcf_expectation_surface(req: DcfExpectationSurfaceRequest) -> DcfExpectationSurfaceResponse:
    if not req.revenueGrowthGridPct or not req.ebitMarginGridPct or len(req.revenueGrowthGridPct) > 101 or len(req.ebitMarginGridPct) > 101:
        raise ValueError("Growth and margin grids must contain 1-101 values each.")
    if req.terminalGrowthPct >= req.waccPct:
        raise ValueError("terminalGrowthPct must be below waccPct.")
    values = []
    for margin in req.ebitMarginGridPct:
        row = []
        for growth in req.revenueGrowthGridPct:
            equity = _dcf_value(req.currentRevenue, growth / 100.0, margin / 100.0, req.taxRatePct / 100.0, req.reinvestmentPctOfRevenue / 100.0, req.years, req.waccPct / 100.0, req.terminalGrowthPct / 100.0, req.netDebt)
            row.append(equity / req.sharesOutstanding)
        values.append(row)
    arr = np.asarray(values, dtype=float)
    if not np.all(np.isfinite(arr)):
        raise ValueError("DCF expectation surface produced a non-finite valuation.")
    return DcfExpectationSurfaceResponse(growthGridPct=req.revenueGrowthGridPct, marginGridPct=req.ebitMarginGridPct, valuePerShareMatrix=values, minimumValuePerShare=float(arr.min()), maximumValuePerShare=float(arr.max()))


class ProjectFinanceYear(BaseModel):
    revenue: float
    operatingCost: float
    capex: float = 0.0
    debtService: float = Field(default=0.0, ge=0)
    depreciation: float = Field(default=0.0, ge=0)


class ProjectFinanceRequest(BaseModel):
    initialEquityInvestment: float = Field(gt=0)
    years: List[ProjectFinanceYear]
    taxRatePct: float = Field(default=25.0, ge=0, le=100)
    equityDiscountRatePct: float = Field(gt=0)
    openingDebt: float = Field(default=0.0, ge=0)


class ProjectFinanceResponse(BaseModel):
    equityNpv: float
    equityIrrPct: Optional[float]
    dscrByYear: List[Optional[float]]
    minimumDscr: Optional[float]
    averageDscr: Optional[float]
    llcrProxy: Optional[float]
    cumulativeEquityCashFlow: float


def _irr(cashflows: List[float]) -> Optional[float]:
    def npv(rate: float) -> float:
        return sum(cf / ((1 + rate) ** i) for i, cf in enumerate(cashflows))
    lo, hi = -0.999, 10.0
    if npv(lo) * npv(hi) > 0:
        return None
    from scipy import optimize
    return float(optimize.brentq(npv, lo, hi))


def project_finance(req: ProjectFinanceRequest) -> ProjectFinanceResponse:
    if not req.years:
        raise ValueError("At least one project year is required.")
    tax = req.taxRatePct / 100.0
    discount = req.equityDiscountRatePct / 100.0
    equity_cf = [-req.initialEquityInvestment]
    dscr: List[Optional[float]] = []
    cfads_pv = 0.0
    for year, item in enumerate(req.years, start=1):
        ebit = item.revenue - item.operatingCost - item.depreciation
        taxes = max(0.0, ebit * tax)
        cfads = item.revenue - item.operatingCost - taxes - item.capex
        equity = cfads - item.debtService
        equity_cf.append(equity)
        dscr.append(cfads / item.debtService if item.debtService > 0 else None)
        cfads_pv += cfads / ((1 + discount) ** year)
    finite_dscr = [x for x in dscr if x is not None]
    npv = sum(cf / ((1 + discount) ** i) for i, cf in enumerate(equity_cf))
    irr = _irr(equity_cf)
    llcr = cfads_pv / req.openingDebt if req.openingDebt > 0 else None
    return ProjectFinanceResponse(
        equityNpv=float(npv), equityIrrPct=None if irr is None else irr * 100.0, dscrByYear=dscr,
        minimumDscr=min(finite_dscr) if finite_dscr else None,
        averageDscr=float(np.mean(finite_dscr)) if finite_dscr else None,
        llcrProxy=None if llcr is None else float(llcr), cumulativeEquityCashFlow=float(sum(equity_cf)),
    )


class SaaSCohort(BaseModel):
    name: str
    startingCustomers: int = Field(gt=0)
    monthlyArpu: float = Field(gt=0)
    monthlyLogoChurnPct: float = Field(ge=0, lt=100)
    monthlyExpansionPct: float = 0.0
    grossMarginPct: float = Field(ge=0, le=100)
    acquisitionCostPerCustomer: float = Field(ge=0)
    monthsSinceAcquisition: int = Field(default=0, ge=0)


class SaaSCohortRequest(BaseModel):
    cohorts: List[SaaSCohort]
    forecastMonths: int = Field(default=60, ge=1, le=240)
    annualDiscountRatePct: float = Field(default=12.0, ge=0, lt=100)


class SaaSCohortResponse(BaseModel):
    cohortPresentValues: Dict[str, float]
    totalCohortValue: float
    grossLtvByCohort: Dict[str, float]
    ltvToCacByCohort: Dict[str, Optional[float]]
    endingCustomersByCohort: Dict[str, float]


def saas_cohort_value(req: SaaSCohortRequest) -> SaaSCohortResponse:
    if not req.cohorts:
        raise ValueError("At least one SaaS cohort is required.")
    monthly_discount = (1 + req.annualDiscountRatePct / 100.0) ** (1 / 12) - 1
    pv_map: Dict[str, float] = {}
    ltv_map: Dict[str, float] = {}
    ratio_map: Dict[str, Optional[float]] = {}
    ending: Dict[str, float] = {}
    for c in req.cohorts:
        if c.name in pv_map:
            raise ValueError(f"Duplicate cohort name: {c.name}")
        customers = float(c.startingCustomers)
        arpu = c.monthlyArpu * ((1 + c.monthlyExpansionPct / 100.0) ** c.monthsSinceAcquisition)
        pv = -c.startingCustomers * c.acquisitionCostPerCustomer
        gross_total = 0.0
        for month in range(1, req.forecastMonths + 1):
            customers *= 1 - c.monthlyLogoChurnPct / 100.0
            arpu *= 1 + c.monthlyExpansionPct / 100.0
            gross_profit = customers * arpu * c.grossMarginPct / 100.0
            gross_total += gross_profit
            pv += gross_profit / ((1 + monthly_discount) ** month)
        gross_ltv = gross_total / c.startingCustomers
        pv_map[c.name] = float(pv)
        ltv_map[c.name] = float(gross_ltv)
        ratio_map[c.name] = float(gross_ltv / c.acquisitionCostPerCustomer) if c.acquisitionCostPerCustomer > 0 else None
        ending[c.name] = float(customers)
    return SaaSCohortResponse(cohortPresentValues=pv_map, totalCohortValue=float(sum(pv_map.values())), grossLtvByCohort=ltv_map, ltvToCacByCohort=ratio_map, endingCustomersByCohort=ending)


class InsuranceEmbeddedValueRequest(BaseModel):
    adjustedNetAssetValue: float
    futureProfitAfterTax: List[float]
    costOfCapitalCharge: List[float]
    discountRatePct: float = Field(gt=0)
    newBusinessValue: float = 0.0


class InsuranceEmbeddedValueResponse(BaseModel):
    presentValueFutureProfits: float
    presentValueCostOfCapital: float
    embeddedValue: float
    appraisedValue: float


def insurance_embedded_value(req: InsuranceEmbeddedValueRequest) -> InsuranceEmbeddedValueResponse:
    if len(req.futureProfitAfterTax) != len(req.costOfCapitalCharge) or not req.futureProfitAfterTax:
        raise ValueError("Future profits and cost-of-capital schedules must align and be non-empty.")
    r = req.discountRatePct / 100.0
    pvfp = sum(v / ((1 + r) ** (i + 1)) for i, v in enumerate(req.futureProfitAfterTax))
    pv_coc = sum(v / ((1 + r) ** (i + 1)) for i, v in enumerate(req.costOfCapitalCharge))
    embedded = req.adjustedNetAssetValue + pvfp - pv_coc
    return InsuranceEmbeddedValueResponse(presentValueFutureProfits=float(pvfp), presentValueCostOfCapital=float(pv_coc), embeddedValue=float(embedded), appraisedValue=float(embedded + req.newBusinessValue))
