"""Integrated three-statement forecast engine with debt/revolver cash sweep."""
from __future__ import annotations
from typing import List
from pydantic import BaseModel, Field


class ThreeStatementRequest(BaseModel):
    forecastYears: int = Field(default=5, ge=1, le=20)
    startingRevenue: float = Field(gt=0.0)
    revenueGrowthPct: List[float]
    ebitdaMarginPct: List[float]
    depreciationPctOfRevenue: List[float]
    capexPctOfRevenue: List[float]
    netWorkingCapitalPctOfRevenue: List[float]
    taxRatePct: float = Field(default=25.0, ge=0.0, le=100.0)
    startingCash: float = Field(ge=0.0)
    minimumCash: float = Field(default=0.0, ge=0.0)
    startingDebt: float = Field(ge=0.0)
    debtInterestRatePct: float = Field(default=5.0, ge=-10.0, le=100.0)
    mandatoryDebtAmortizationPct: float = Field(default=0.0, ge=0.0, le=100.0)
    debtCapacity: float = Field(default=1e30, gt=0.0)
    startingNetPPE: float = Field(ge=0.0)
    startingNWC: float
    annualDividends: List[float] = Field(default_factory=list)
    cashSweep: bool = True


class StatementYear(BaseModel):
    year: int
    revenue: float
    ebitda: float
    depreciation: float
    ebit: float
    interestExpense: float
    pretaxIncome: float
    taxes: float
    netIncome: float
    capex: float
    netWorkingCapital: float
    changeInNWC: float
    cashFromOperations: float
    cashFromInvesting: float
    debtChange: float
    dividends: float
    cashFromFinancing: float
    endingCash: float
    endingDebt: float
    endingNetPPE: float
    endingEquity: float
    totalAssets: float
    liabilitiesAndEquity: float
    balanceCheck: float
    freeCashFlowBeforeFinancing: float
    liquidityShortfall: float


class ThreeStatementResponse(BaseModel):
    years: List[StatementYear]
    maxAbsoluteBalanceCheck: float
    endingCash: float
    endingDebt: float
    endingEquity: float
    cumulativeFreeCashFlowBeforeFinancing: float


def integrated_three_statement(req: ThreeStatementRequest) -> ThreeStatementResponse:
    n = req.forecastYears
    vecs = [req.revenueGrowthPct, req.ebitdaMarginPct, req.depreciationPctOfRevenue, req.capexPctOfRevenue, req.netWorkingCapitalPctOfRevenue]
    if any(len(v) != n for v in vecs):
        raise ValueError("All operating driver vectors must have forecastYears entries.")
    dividends = req.annualDividends or [0.0] * n
    if len(dividends) != n:
        raise ValueError("annualDividends must be empty or have forecastYears entries.")
    if req.startingDebt > req.debtCapacity + 1e-9:
        raise ValueError("startingDebt exceeds debtCapacity.")
    cash, debt, ppe, nwc = req.startingCash, req.startingDebt, req.startingNetPPE, req.startingNWC
    equity = cash + ppe + nwc - debt
    revenue = req.startingRevenue
    rows, cumulative = [], 0.0
    for i in range(n):
        revenue *= 1 + req.revenueGrowthPct[i] / 100
        ebitda = revenue * req.ebitdaMarginPct[i] / 100
        dep = revenue * req.depreciationPctOfRevenue[i] / 100
        ebit = ebitda - dep
        capex = revenue * req.capexPctOfRevenue[i] / 100
        target_nwc = revenue * req.netWorkingCapitalPctOfRevenue[i] / 100
        delta_nwc = target_nwc - nwc
        div = max(0.0, dividends[i])
        opening_debt = debt
        ending_debt = debt
        liquidity_shortfall = 0.0
        for _ in range(100):
            avg_debt = (opening_debt + ending_debt) / 2
            interest = avg_debt * req.debtInterestRatePct / 100
            pretax = ebit - interest
            taxes = max(0.0, pretax) * req.taxRatePct / 100
            ni = pretax - taxes
            cfo = ni + dep - delta_nwc
            fcf = cfo - capex - div
            mandatory = min(opening_debt, opening_debt * req.mandatoryDebtAmortizationPct / 100)
            provisional_cash = cash + fcf - mandatory
            provisional_debt = max(0.0, opening_debt - mandatory)
            if provisional_cash < req.minimumCash:
                draw = min(req.debtCapacity - provisional_debt, req.minimumCash - provisional_cash)
                new_debt = provisional_debt + max(0.0, draw)
                end_cash = provisional_cash + max(0.0, draw)
                short = max(0.0, req.minimumCash - end_cash)
            elif req.cashSweep and provisional_cash > req.minimumCash and provisional_debt > 0:
                repay = min(provisional_debt, provisional_cash - req.minimumCash)
                new_debt, end_cash, short = provisional_debt - repay, provisional_cash - repay, 0.0
            else:
                new_debt, end_cash, short = provisional_debt, provisional_cash, 0.0
            if abs(new_debt - ending_debt) < 1e-9:
                ending_debt, liquidity_shortfall = new_debt, short
                break
            ending_debt = 0.5 * ending_debt + 0.5 * new_debt
        avg_debt = (opening_debt + ending_debt) / 2
        interest = avg_debt * req.debtInterestRatePct / 100
        pretax = ebit - interest
        taxes = max(0.0, pretax) * req.taxRatePct / 100
        ni = pretax - taxes
        cfo = ni + dep - delta_nwc
        fcf_before_financing = cfo - capex - div
        mandatory = min(opening_debt, opening_debt * req.mandatoryDebtAmortizationPct / 100)
        provisional_cash = cash + fcf_before_financing - mandatory
        provisional_debt = max(0.0, opening_debt - mandatory)
        if provisional_cash < req.minimumCash:
            draw = max(0.0, min(req.debtCapacity - provisional_debt, req.minimumCash - provisional_cash))
            debt_change = -mandatory + draw
            ending_debt, end_cash = provisional_debt + draw, provisional_cash + draw
            liquidity_shortfall = max(0.0, req.minimumCash - end_cash)
        elif req.cashSweep and provisional_cash > req.minimumCash and provisional_debt > 0:
            repay = min(provisional_debt, provisional_cash - req.minimumCash)
            debt_change = -mandatory - repay
            ending_debt, end_cash, liquidity_shortfall = provisional_debt - repay, provisional_cash - repay, 0.0
        else:
            debt_change, ending_debt, end_cash, liquidity_shortfall = -mandatory, provisional_debt, provisional_cash, 0.0
        ppe = ppe + capex - dep
        nwc = target_nwc
        equity = equity + ni - div
        assets = end_cash + ppe + nwc
        liabilities_equity = ending_debt + equity
        check = assets - liabilities_equity
        cumulative += fcf_before_financing
        rows.append(StatementYear(year=i + 1, revenue=revenue, ebitda=ebitda, depreciation=dep, ebit=ebit,
                                  interestExpense=interest, pretaxIncome=pretax, taxes=taxes, netIncome=ni, capex=capex,
                                  netWorkingCapital=nwc, changeInNWC=delta_nwc, cashFromOperations=cfo,
                                  cashFromInvesting=-capex, debtChange=debt_change, dividends=div,
                                  cashFromFinancing=debt_change - div, endingCash=end_cash, endingDebt=ending_debt,
                                  endingNetPPE=ppe, endingEquity=equity, totalAssets=assets,
                                  liabilitiesAndEquity=liabilities_equity, balanceCheck=check,
                                  freeCashFlowBeforeFinancing=fcf_before_financing, liquidityShortfall=liquidity_shortfall))
        cash, debt = end_cash, ending_debt
    return ThreeStatementResponse(years=rows, maxAbsoluteBalanceCheck=float(max(abs(r.balanceCheck) for r in rows)),
                                  endingCash=cash, endingDebt=debt, endingEquity=equity,
                                  cumulativeFreeCashFlowBeforeFinancing=float(cumulative))
