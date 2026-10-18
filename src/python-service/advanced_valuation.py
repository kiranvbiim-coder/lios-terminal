"""Advanced valuation engines with explicit assumptions and reproducible scenarios."""
from __future__ import annotations

from typing import Dict, List, Literal, Optional

import numpy as np
from pydantic import BaseModel, Field
from scipy import optimize


class DcfScenario(BaseModel):
    name: str
    revenueGrowthPct: float
    ebitMarginPct: float
    taxRatePct: float = Field(ge=0, le=100)
    reinvestmentPctOfRevenue: float = Field(ge=0)
    probability: float = Field(ge=0, le=1)


class ProbabilisticDcfRequest(BaseModel):
    currentRevenue: float = Field(gt=0)
    netDebt: float = 0.0
    sharesOutstanding: float = Field(gt=0)
    years: int = Field(default=5, ge=1, le=20)
    waccPct: float = Field(gt=0, lt=100)
    terminalGrowthPct: float = Field(gt=-50, lt=50)
    scenarios: List[DcfScenario]
    nSimulations: int = Field(default=20000, ge=1000, le=500000)
    growthVolPct: float = Field(default=2.0, ge=0, le=50)
    marginVolPct: float = Field(default=2.0, ge=0, le=50)
    seed: int = 42


class ProbabilisticDcfResponse(BaseModel):
    expectedEquityValue: float
    expectedValuePerShare: float
    medianValuePerShare: float
    p05ValuePerShare: float
    p95ValuePerShare: float
    downsideProbabilityBelowZeroEquity: float
    scenarioWeightedDeterministicValuePerShare: float
    seed: int


def _dcf_value(revenue: float, growth: float, margin: float, tax: float, reinvestment: float, years: int, wacc: float, terminal_growth: float, net_debt: float) -> float:
    if wacc <= terminal_growth:
        raise ValueError("WACC must exceed terminal growth.")
    pv = 0.0
    rev = revenue
    final_fcff = 0.0
    for year in range(1, years + 1):
        next_rev = rev * (1.0 + growth)
        ebit = next_rev * margin
        nopat = ebit * (1.0 - tax)
        reinvest = next_rev * reinvestment
        fcff = nopat - reinvest
        pv += fcff / ((1.0 + wacc) ** year)
        final_fcff = fcff
        rev = next_rev
    terminal = final_fcff * (1.0 + terminal_growth) / (wacc - terminal_growth)
    enterprise = pv + terminal / ((1.0 + wacc) ** years)
    return enterprise - net_debt


def probabilistic_dcf(req: ProbabilisticDcfRequest) -> ProbabilisticDcfResponse:
    if not req.scenarios:
        raise ValueError("At least one DCF scenario is required.")
    probs = np.asarray([s.probability for s in req.scenarios], dtype=float)
    if probs.sum() <= 0:
        raise ValueError("Scenario probabilities must have positive total mass.")
    probs /= probs.sum()
    wacc, tg = req.waccPct / 100.0, req.terminalGrowthPct / 100.0
    deterministic = []
    for s in req.scenarios:
        deterministic.append(_dcf_value(req.currentRevenue, s.revenueGrowthPct / 100.0, s.ebitMarginPct / 100.0, s.taxRatePct / 100.0, s.reinvestmentPctOfRevenue / 100.0, req.years, wacc, tg, req.netDebt) / req.sharesOutstanding)
    weighted_det = float(probs @ np.asarray(deterministic))

    rng = np.random.default_rng(req.seed)
    scenario_idx = rng.choice(len(req.scenarios), size=req.nSimulations, p=probs)
    values = np.empty(req.nSimulations, dtype=float)
    for i, idx in enumerate(scenario_idx):
        s = req.scenarios[int(idx)]
        growth = rng.normal(s.revenueGrowthPct, req.growthVolPct) / 100.0
        margin = rng.normal(s.ebitMarginPct, req.marginVolPct) / 100.0
        equity = _dcf_value(req.currentRevenue, growth, margin, s.taxRatePct / 100.0, s.reinvestmentPctOfRevenue / 100.0, req.years, wacc, tg, req.netDebt)
        values[i] = equity / req.sharesOutstanding
    equity_values = values * req.sharesOutstanding
    return ProbabilisticDcfResponse(
        expectedEquityValue=float(equity_values.mean()),
        expectedValuePerShare=float(values.mean()),
        medianValuePerShare=float(np.median(values)),
        p05ValuePerShare=float(np.quantile(values, 0.05)),
        p95ValuePerShare=float(np.quantile(values, 0.95)),
        downsideProbabilityBelowZeroEquity=float(np.mean(values < 0)),
        scenarioWeightedDeterministicValuePerShare=weighted_det,
        seed=req.seed,
    )



class DcfSensitivityCase(BaseModel):
    freeCashFlows: List[float]
    waccPct: float = Field(gt=0, lt=100)
    terminalMethod: Literal["gordon_growth", "exit_multiple"] = "gordon_growth"
    terminalGrowthPct: Optional[float] = None
    exitMultiple: Optional[float] = Field(default=None, gt=0)
    terminalMetric: Optional[float] = None


class DcfSensitivityRequest(DcfSensitivityCase):
    netDebt: float = 0.0
    sharesOutstanding: float = Field(gt=0)
    waccGridPct: List[float]
    terminalGrowthGridPct: List[float]
    bearCase: DcfSensitivityCase
    bullCase: DcfSensitivityCase


class DcfSensitivityValue(BaseModel):
    pvExplicitCashFlows: float
    terminalValue: float
    pvTerminalValue: float
    enterpriseValue: float
    equityValue: float
    valuePerShare: float
    waccPct: float
    terminalMethod: Literal["gordon_growth", "exit_multiple"]
    terminalGrowthPct: Optional[float] = None
    exitMultiple: Optional[float] = None
    terminalMetric: Optional[float] = None


class DcfSensitivityGrid(BaseModel):
    waccPct: List[float]
    terminalGrowthPct: List[float]
    valuePerShareMatrix: List[List[float]]


class DcfSensitivityScenarios(BaseModel):
    bear: DcfSensitivityValue
    base: DcfSensitivityValue
    bull: DcfSensitivityValue


class DcfSensitivityConventions(BaseModel):
    discountTiming: Literal["year_end"] = "year_end"
    explicitCashFlowTiming: Literal["end_of_period"] = "end_of_period"
    sensitivityTerminalMethod: Literal["gordon_growth"] = "gordon_growth"
    currencyUnits: Literal["same_as_free_cash_flows_and_net_debt"] = "same_as_free_cash_flows_and_net_debt"
    perShareUnits: Literal["currency_units_per_share"] = "currency_units_per_share"


class DcfSensitivityResponse(BaseModel):
    base: DcfSensitivityValue
    sensitivity: DcfSensitivityGrid
    scenarios: DcfSensitivityScenarios
    conventions: DcfSensitivityConventions


def _validate_dcf_case(case: DcfSensitivityCase, label: str) -> None:
    if not case.freeCashFlows:
        raise ValueError(f"{label} requires at least one free cash flow.")
    if not all(np.isfinite(value) for value in case.freeCashFlows):
        raise ValueError(f"{label} free cash flows must be finite.")
    if not np.isfinite(case.waccPct):
        raise ValueError(f"{label} WACC must be finite.")
    wacc = case.waccPct / 100.0
    if case.terminalMethod == "gordon_growth":
        if case.terminalGrowthPct is None or not np.isfinite(case.terminalGrowthPct):
            raise ValueError(f"{label} Gordon-growth terminal method requires terminalGrowthPct.")
        growth = case.terminalGrowthPct / 100.0
        if wacc <= growth:
            raise ValueError(f"{label} WACC must exceed terminal growth.")
    else:
        if case.exitMultiple is None or case.terminalMetric is None:
            raise ValueError(f"{label} exit-multiple terminal method requires exitMultiple and terminalMetric.")
        if not np.isfinite(case.exitMultiple) or case.exitMultiple <= 0:
            raise ValueError(f"{label} exitMultiple must be a positive finite value.")
        if not np.isfinite(case.terminalMetric) or case.terminalMetric <= 0:
            raise ValueError(f"{label} terminalMetric must be a positive finite value.")


def _explicit_dcf_value(
    case: DcfSensitivityCase,
    net_debt: float,
    shares_outstanding: float,
) -> DcfSensitivityValue:
    _validate_dcf_case(case, "DCF case")
    wacc = case.waccPct / 100.0
    pv_explicit = sum(
        float(fcf) / ((1.0 + wacc) ** year)
        for year, fcf in enumerate(case.freeCashFlows, start=1)
    )
    if case.terminalMethod == "gordon_growth":
        growth = float(case.terminalGrowthPct) / 100.0
        terminal_value = float(case.freeCashFlows[-1]) * (1.0 + growth) / (wacc - growth)
    else:
        terminal_value = float(case.terminalMetric) * float(case.exitMultiple)
    pv_terminal = terminal_value / ((1.0 + wacc) ** len(case.freeCashFlows))
    enterprise_value = pv_explicit + pv_terminal
    equity_value = enterprise_value - net_debt
    return DcfSensitivityValue(
        pvExplicitCashFlows=pv_explicit,
        terminalValue=terminal_value,
        pvTerminalValue=pv_terminal,
        enterpriseValue=enterprise_value,
        equityValue=equity_value,
        valuePerShare=equity_value / shares_outstanding,
        waccPct=case.waccPct,
        terminalMethod=case.terminalMethod,
        terminalGrowthPct=case.terminalGrowthPct,
        exitMultiple=case.exitMultiple,
        terminalMetric=case.terminalMetric,
    )


def dcf_sensitivity(req: DcfSensitivityRequest) -> DcfSensitivityResponse:
    if not np.isfinite(req.netDebt):
        raise ValueError("netDebt must be finite.")
    if not np.isfinite(req.sharesOutstanding) or req.sharesOutstanding <= 0:
        raise ValueError("sharesOutstanding must be a positive finite value.")
    base_case = DcfSensitivityCase(
        freeCashFlows=req.freeCashFlows,
        waccPct=req.waccPct,
        terminalMethod=req.terminalMethod,
        terminalGrowthPct=req.terminalGrowthPct,
        exitMultiple=req.exitMultiple,
        terminalMetric=req.terminalMetric,
    )
    _validate_dcf_case(base_case, "Base case")
    _validate_dcf_case(req.bearCase, "Bear case")
    _validate_dcf_case(req.bullCase, "Bull case")
    if not req.waccGridPct or not req.terminalGrowthGridPct:
        raise ValueError("Sensitivity grid requires at least one WACC and one terminal-growth input.")
    if len(req.waccGridPct) > 25 or len(req.terminalGrowthGridPct) > 25:
        raise ValueError("Sensitivity grid supports at most 25 WACC values and 25 terminal-growth values.")
    if not all(np.isfinite(value) and 0 < value < 100 for value in req.waccGridPct):
        raise ValueError("Sensitivity WACC inputs must be finite percentages between 0 and 100.")
    if not all(np.isfinite(value) for value in req.terminalGrowthGridPct):
        raise ValueError("Sensitivity terminal-growth inputs must be finite percentages.")

    value_matrix: List[List[float]] = []
    for wacc_pct in req.waccGridPct:
        row: List[float] = []
        for growth_pct in req.terminalGrowthGridPct:
            if wacc_pct <= growth_pct:
                raise ValueError(
                    f"Sensitivity grid WACC {wacc_pct}% must exceed terminal growth {growth_pct}%."
                )
            grid_case = DcfSensitivityCase(
                freeCashFlows=req.freeCashFlows,
                waccPct=wacc_pct,
                terminalMethod="gordon_growth",
                terminalGrowthPct=growth_pct,
            )
            row.append(_explicit_dcf_value(
                grid_case, req.netDebt, req.sharesOutstanding
            ).valuePerShare)
        value_matrix.append(row)

    base_value = _explicit_dcf_value(base_case, req.netDebt, req.sharesOutstanding)
    return DcfSensitivityResponse(
        base=base_value,
        sensitivity=DcfSensitivityGrid(
            waccPct=req.waccGridPct,
            terminalGrowthPct=req.terminalGrowthGridPct,
            valuePerShareMatrix=value_matrix,
        ),
        scenarios=DcfSensitivityScenarios(
            bear=_explicit_dcf_value(req.bearCase, req.netDebt, req.sharesOutstanding),
            base=base_value,
            bull=_explicit_dcf_value(req.bullCase, req.netDebt, req.sharesOutstanding),
        ),
        conventions=DcfSensitivityConventions(),
    )


class ReverseDcfRequest(BaseModel):
    currentRevenue: float = Field(gt=0)
    marketEquityValue: float = Field(gt=0)
    netDebt: float = 0.0
    years: int = Field(default=5, ge=1, le=20)
    waccPct: float = Field(gt=0, lt=100)
    terminalGrowthPct: float
    ebitMarginPct: float
    taxRatePct: float = Field(ge=0, le=100)
    reinvestmentPctOfRevenue: float = Field(ge=0)
    solveFor: str = Field(default="revenue_growth")


class ReverseDcfResponse(BaseModel):
    impliedRevenueGrowthPct: Optional[float] = None
    impliedEbitMarginPct: Optional[float] = None
    repricedEquityValue: float
    absoluteError: float


def reverse_dcf(req: ReverseDcfRequest) -> ReverseDcfResponse:
    wacc, tg = req.waccPct / 100.0, req.terminalGrowthPct / 100.0
    target = req.marketEquityValue
    if req.solveFor == "revenue_growth":
        def f(x: float) -> float:
            return _dcf_value(req.currentRevenue, x, req.ebitMarginPct / 100.0, req.taxRatePct / 100.0, req.reinvestmentPctOfRevenue / 100.0, req.years, wacc, tg, req.netDebt) - target
        root = float(optimize.brentq(f, -0.9, 2.0))
        repriced = f(root) + target
        return ReverseDcfResponse(impliedRevenueGrowthPct=root * 100.0, repricedEquityValue=repriced, absoluteError=abs(repriced - target))
    if req.solveFor == "ebit_margin":
        def f(x: float) -> float:
            return _dcf_value(req.currentRevenue, 0.0, x, req.taxRatePct / 100.0, req.reinvestmentPctOfRevenue / 100.0, req.years, wacc, tg, req.netDebt) - target
        root = float(optimize.brentq(f, -1.0, 2.0))
        repriced = f(root) + target
        return ReverseDcfResponse(impliedEbitMarginPct=root * 100.0, repricedEquityValue=repriced, absoluteError=abs(repriced - target))
    raise ValueError("solveFor must be revenue_growth or ebit_margin.")


class ResidualIncomeRequest(BaseModel):
    bookValueEquity: float
    roePct: List[float]
    costOfEquityPct: float = Field(gt=0)
    payoutRatioPct: float = Field(default=0.0, ge=0, le=100)
    terminalRoePct: Optional[float] = None
    terminalGrowthPct: float = 0.0


class ResidualIncomeResponse(BaseModel):
    equityValue: float
    residualIncomePv: float
    terminalValuePv: float


def residual_income_valuation(req: ResidualIncomeRequest) -> ResidualIncomeResponse:
    if not req.roePct:
        raise ValueError("At least one forecast ROE is required.")
    ke = req.costOfEquityPct / 100.0
    payout = req.payoutRatioPct / 100.0
    bv = req.bookValueEquity
    ri_pv = 0.0
    for year, roe_pct in enumerate(req.roePct, start=1):
        roe = roe_pct / 100.0
        earnings = bv * roe
        residual = bv * (roe - ke)
        ri_pv += residual / ((1 + ke) ** year)
        bv += earnings * (1 - payout)
    terminal_roe = (req.terminalRoePct if req.terminalRoePct is not None else req.roePct[-1]) / 100.0
    g = req.terminalGrowthPct / 100.0
    if ke <= g:
        raise ValueError("Cost of equity must exceed terminal growth.")
    terminal_ri = bv * (terminal_roe - ke)
    terminal = terminal_ri * (1 + g) / (ke - g)
    terminal_pv = terminal / ((1 + ke) ** len(req.roePct))
    return ResidualIncomeResponse(equityValue=req.bookValueEquity + ri_pv + terminal_pv, residualIncomePv=ri_pv, terminalValuePv=terminal_pv)


class EvaRequest(BaseModel):
    investedCapital: float
    nopat: List[float]
    waccPct: float = Field(gt=0)
    capitalGrowthPct: float = 0.0
    terminalEvaGrowthPct: float = 0.0


class EvaResponse(BaseModel):
    enterpriseValue: float
    evaPv: float
    terminalEvaPv: float


def eva_valuation(req: EvaRequest) -> EvaResponse:
    if not req.nopat:
        raise ValueError("At least one NOPAT forecast is required.")
    wacc = req.waccPct / 100.0
    capital_growth = req.capitalGrowthPct / 100.0
    terminal_growth = req.terminalEvaGrowthPct / 100.0
    if wacc <= terminal_growth:
        raise ValueError("WACC must exceed terminal EVA growth.")
    capital = req.investedCapital
    pv = 0.0
    last_eva = 0.0
    for year, nopat in enumerate(req.nopat, start=1):
        eva = nopat - wacc * capital
        pv += eva / ((1 + wacc) ** year)
        last_eva = eva
        capital *= 1 + capital_growth
    terminal = last_eva * (1 + terminal_growth) / (wacc - terminal_growth)
    terminal_pv = terminal / ((1 + wacc) ** len(req.nopat))
    return EvaResponse(enterpriseValue=req.investedCapital + pv + terminal_pv, evaPv=pv, terminalEvaPv=terminal_pv)


class SegmentValue(BaseModel):
    name: str
    metric: float
    multiple: float
    ownershipPct: float = Field(default=100.0, ge=0, le=100)


class SotpRequest(BaseModel):
    segments: List[SegmentValue]
    netDebt: float = 0.0
    nonOperatingAssets: float = 0.0
    sharesOutstanding: float = Field(gt=0)


class SotpResponse(BaseModel):
    segmentValues: Dict[str, float]
    enterpriseValue: float
    equityValue: float
    valuePerShare: float


def sum_of_parts(req: SotpRequest) -> SotpResponse:
    if not req.segments:
        raise ValueError("At least one segment is required.")
    values = {s.name: s.metric * s.multiple * s.ownershipPct / 100.0 for s in req.segments}
    ev = float(sum(values.values()))
    equity = ev - req.netDebt + req.nonOperatingAssets
    return SotpResponse(segmentValues=values, enterpriseValue=ev, equityValue=equity, valuePerShare=equity / req.sharesOutstanding)


class MergerRequest(BaseModel):
    acquirerShares: float = Field(gt=0)
    acquirerNetIncome: float
    acquirerSharePrice: float = Field(gt=0)
    targetShares: float = Field(gt=0)
    targetNetIncome: float
    offerPricePerShare: float = Field(gt=0)
    stockConsiderationPct: float = Field(default=100.0, ge=0, le=100)
    debtInterestRatePct: float = Field(default=0.0, ge=0)
    taxRatePct: float = Field(default=25.0, ge=0, le=100)
    annualSynergiesAfterTax: float = 0.0


class MergerResponse(BaseModel):
    proFormaEps: float
    standaloneAcquirerEps: float
    accretionDilutionPct: float
    newSharesIssued: float
    debtFinancing: float
    breakEvenSynergiesAfterTax: float


def merger_accretion_dilution(req: MergerRequest) -> MergerResponse:
    purchase = req.targetShares * req.offerPricePerShare
    stock_pct = req.stockConsiderationPct / 100.0
    stock_value = purchase * stock_pct
    debt = purchase - stock_value
    new_shares = stock_value / req.acquirerSharePrice
    after_tax_interest = debt * req.debtInterestRatePct / 100.0 * (1 - req.taxRatePct / 100.0)
    standalone_eps = req.acquirerNetIncome / req.acquirerShares
    proforma_income = req.acquirerNetIncome + req.targetNetIncome + req.annualSynergiesAfterTax - after_tax_interest
    proforma_shares = req.acquirerShares + new_shares
    eps = proforma_income / proforma_shares
    accretion = (eps / standalone_eps - 1.0) * 100.0 if standalone_eps != 0 else float("nan")
    break_even_income = standalone_eps * proforma_shares
    break_even_synergy = break_even_income - req.acquirerNetIncome - req.targetNetIncome + after_tax_interest
    return MergerResponse(proFormaEps=eps, standaloneAcquirerEps=standalone_eps, accretionDilutionPct=accretion, newSharesIssued=new_shares, debtFinancing=debt, breakEvenSynergiesAfterTax=break_even_synergy)
