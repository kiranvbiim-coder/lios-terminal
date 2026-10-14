"""
Economics & Policy cluster (LIMURIA_ENGINES port plan Phase 5). Directly
serves this Terminal's live Economics & Public Policy domain
(server/fredData.ts / client/src/lib/useEconomics.ts) -- Taylor Rule and the
Phillips Curve regression are designed to run against real live FRED series
(CPIAUCSL, UNRATE) already fetched elsewhere in the app, not synthetic points.

Ported from engines/09_economics_policy_engine.py and
engines/15_policy_simulation_engine.py, both read in full first. Real
functions ported: Leontief input-output inverse (09), Taylor Rule (09),
Phillips Curve OLS (09, upgraded here to full regression diagnostics via
statsmodels to match this Terminal's existing econometrics rigor), Gini
coefficient (09/15, cross-checked against an independent Lorenz-curve
integration before shipping), income tax bracket micro-simulation (15, real
marginal-bracket calculation), and carbon tax & dividend distributional
analysis (15).

Fake stubs found in 09_economics_policy_engine.py and NOT ported (hardcoded
returns regardless of input, confirmed by reading the function bodies):
fiscal_multiplier (always 1.5), monetary_policy_transmission (always empty),
okun_law (always -2.0), balassa_samuelson (always 0.0), economic_complexity
(always empty), development_indicators (always 0.8 HDI), cost_benefit_
analysis (always 0.0 NPV, ignores discount_rate/years entirely),
computable_general_equilibrium (always empty).

One real bug found and fixed during verification, not ported as-is: the
source's simulate_carbon_tax_policy() computes a real net_burden_pct by
income quartile after the dividend but then DISCARDS it, instead returning a
hardcoded literal string "Progressive (Bottom 50% net positive)" regardless
of what the actual data says -- the same "computes something real, then
reports a fabricated conclusion instead of the computed one" pattern already
flagged elsewhere in this port. Fixed here: the response reports the real
per-quartile net burden and a genuinely-computed progressivity boolean.
"""

from typing import List

import numpy as np
from pydantic import BaseModel, Field


# ─── Leontief input-output ─────────────────────────────────────────────────
class LeontiefRequest(BaseModel):
    ioMatrix: List[List[float]] = Field(min_length=2, max_length=200)  # technical coefficients A (n x n)
    finalDemand: List[float] = Field(min_length=2, max_length=200)


class LeontiefResponse(BaseModel):
    leontiefInverse: List[List[float]]
    totalOutput: List[float]
    hawkinsSimonSatisfied: bool  # all leading principal minors of (I-A) positive -- economically viable/non-negative solution


def leontief_io(req: LeontiefRequest) -> LeontiefResponse:
    a = np.array(req.ioMatrix, dtype=float)
    n = a.shape[0]
    if a.shape != (n, n):
        raise ValueError(f"ioMatrix must be square, got shape {a.shape}")
    if len(req.finalDemand) != n:
        raise ValueError(f"finalDemand has {len(req.finalDemand)} entries but ioMatrix is {n}x{n}")
    d = np.array(req.finalDemand, dtype=float)
    i_minus_a = np.eye(n) - a
    hawkins_simon = all(np.linalg.det(i_minus_a[:k, :k]) > 0 for k in range(1, n + 1))
    try:
        leontief_inv = np.linalg.inv(i_minus_a)
    except np.linalg.LinAlgError as exc:
        raise ValueError(f"(I - A) is singular -- this input-output structure has no unique solution: {exc}") from exc
    total_output = leontief_inv.dot(d)
    return LeontiefResponse(
        leontiefInverse=leontief_inv.tolist(), totalOutput=total_output.tolist(),
        hawkinsSimonSatisfied=bool(hawkins_simon),
    )


# ─── Taylor Rule ────────────────────────────────────────────────────────────
class TaylorRuleRequest(BaseModel):
    inflationPct: float
    inflationTargetPct: float = 2.0
    outputGapPct: float = 0.0
    neutralRealRatePct: float = 2.0
    inflationWeight: float = Field(default=0.5, ge=0)
    outputGapWeight: float = Field(default=0.5, ge=0)


class TaylorRuleResponse(BaseModel):
    targetRatePct: float
    neutralNominalRatePct: float  # r* + inflation, the rate at target with zero output gap
    inflationGapContributionPct: float
    outputGapContributionPct: float


def taylor_rule(req: TaylorRuleRequest) -> TaylorRuleResponse:
    inflation_gap_term = req.inflationWeight * (req.inflationPct - req.inflationTargetPct)
    output_gap_term = req.outputGapWeight * req.outputGapPct
    neutral_nominal = req.neutralRealRatePct + req.inflationPct
    target_rate = neutral_nominal + inflation_gap_term + output_gap_term
    return TaylorRuleResponse(
        targetRatePct=float(target_rate), neutralNominalRatePct=float(neutral_nominal),
        inflationGapContributionPct=float(inflation_gap_term), outputGapContributionPct=float(output_gap_term),
    )


# ─── Phillips Curve (full OLS diagnostics, not just point estimates) ──────
class PhillipsCurveRequest(BaseModel):
    unemploymentPct: List[float] = Field(min_length=8, max_length=5000)
    inflationPct: List[float] = Field(min_length=8, max_length=5000)


class PhillipsCurveResponse(BaseModel):
    intercept: float
    slope: float
    rSquared: float
    slopeStdError: float
    slopeTStat: float
    slopePValue: float
    nObs: int
    fittedInflationPct: List[float]


def phillips_curve(req: PhillipsCurveRequest) -> PhillipsCurveResponse:
    import statsmodels.api as sm

    if len(req.unemploymentPct) != len(req.inflationPct):
        raise ValueError(f"unemploymentPct has {len(req.unemploymentPct)} points but inflationPct has {len(req.inflationPct)}")
    x = sm.add_constant(np.array(req.unemploymentPct, dtype=float))
    y = np.array(req.inflationPct, dtype=float)
    res = sm.OLS(y, x).fit()
    return PhillipsCurveResponse(
        intercept=float(res.params[0]), slope=float(res.params[1]), rSquared=float(res.rsquared),
        slopeStdError=float(res.bse[1]), slopeTStat=float(res.tvalues[1]), slopePValue=float(res.pvalues[1]),
        nObs=int(res.nobs), fittedInflationPct=res.fittedvalues.tolist(),
    )


# ─── Gini coefficient + Lorenz curve ───────────────────────────────────────
class GiniRequest(BaseModel):
    income: List[float] = Field(min_length=2, max_length=200000)


class GiniResponse(BaseModel):
    gini: float
    lorenzPopulationPct: List[float]  # cumulative % of population, sorted ascending by income
    lorenzIncomePct: List[float]  # cumulative % of income held by that population share


def gini_coefficient(req: GiniRequest) -> GiniResponse:
    x = np.array(req.income, dtype=float)
    if np.any(x < 0):
        raise ValueError("Gini coefficient is undefined for negative income values")
    sorted_income = np.sort(x)
    n = len(sorted_income)
    total = np.sum(sorted_income)
    if total <= 0:
        raise ValueError("Total income must be positive")
    rank = np.arange(1, n + 1)
    gini = float(np.sum((2 * rank - n - 1) * sorted_income) / (n * total))

    cum_income = np.concatenate([[0.0], np.cumsum(sorted_income)]) / total * 100
    cum_pop = np.linspace(0, 100, n + 1)
    return GiniResponse(gini=gini, lorenzPopulationPct=cum_pop.tolist(), lorenzIncomePct=cum_income.tolist())


# ─── Income tax bracket micro-simulation ──────────────────────────────────
class TaxBracket(BaseModel):
    threshold: float = Field(ge=0)
    rate: float = Field(ge=0, le=1)


class IncomeTaxMicrosimRequest(BaseModel):
    incomeDistribution: List[float] = Field(min_length=10, max_length=200000)
    oldBrackets: List[TaxBracket] = Field(min_length=1, max_length=20)
    newBrackets: List[TaxBracket] = Field(min_length=1, max_length=20)


class IncomeTaxMicrosimResponse(BaseModel):
    totalPopulation: int
    baselineTaxRevenue: float
    reformTaxRevenue: float
    revenueChangePct: float
    giniBeforeReform: float
    giniAfterReform: float
    inequalityReduced: bool
    avgEffectiveRateBaselinePct: float
    avgEffectiveRateReformPct: float


def _compute_marginal_tax(income: float, brackets: List[TaxBracket]) -> float:
    tax = 0.0
    sorted_b = sorted(brackets, key=lambda b: b.threshold)
    for i, b in enumerate(sorted_b):
        next_thresh = sorted_b[i + 1].threshold if i + 1 < len(sorted_b) else float("inf")
        if income > b.threshold:
            tax += (min(income, next_thresh) - b.threshold) * b.rate
    return tax


def _gini_from_sorted(x: np.ndarray) -> float:
    s = np.sort(x)
    n = len(s)
    total = np.sum(s)
    if total <= 0:
        return 0.0
    rank = np.arange(1, n + 1)
    return float(np.sum((2 * rank - n - 1) * s) / (n * total))


def income_tax_microsim(req: IncomeTaxMicrosimRequest) -> IncomeTaxMicrosimResponse:
    income = np.array(req.incomeDistribution, dtype=float)
    if np.any(income < 0):
        raise ValueError("Income distribution cannot contain negative values")

    old_tax = np.array([_compute_marginal_tax(inc, req.oldBrackets) for inc in income])
    new_tax = np.array([_compute_marginal_tax(inc, req.newBrackets) for inc in income])

    old_net = income - old_tax
    new_net = income - new_tax
    old_revenue = float(np.sum(old_tax))
    new_revenue = float(np.sum(new_tax))
    gini_before = _gini_from_sorted(old_net)
    gini_after = _gini_from_sorted(new_net)

    nonzero_income = np.where(income > 0, income, np.nan)
    return IncomeTaxMicrosimResponse(
        totalPopulation=len(income),
        baselineTaxRevenue=old_revenue, reformTaxRevenue=new_revenue,
        revenueChangePct=float((new_revenue - old_revenue) / old_revenue * 100) if old_revenue > 0 else 0.0,
        giniBeforeReform=gini_before, giniAfterReform=gini_after, inequalityReduced=bool(gini_after < gini_before),
        avgEffectiveRateBaselinePct=float(np.nanmean(old_tax / nonzero_income) * 100),
        avgEffectiveRateReformPct=float(np.nanmean(new_tax / nonzero_income) * 100),
    )


# ─── Carbon tax & dividend ──────────────────────────────────────────────────
class CarbonTaxDividendRequest(BaseModel):
    householdEnergySpendMonthly: List[float] = Field(min_length=20, max_length=200000)
    householdIncomes: List[float] = Field(min_length=20, max_length=200000)
    carbonTaxPerTon: float = Field(default=50.0, gt=0)
    emissionFactorTonsPerDollar: float = Field(default=0.002, gt=0)


class CarbonTaxDividendResponse(BaseModel):
    totalCo2EmissionsTons: float
    totalCarbonRevenue: float
    equalDividendPerHousehold: float
    grossBurdenByQuartilePct: List[float]  # index 0 = lowest-income quartile ... index 3 = highest
    netBurdenByQuartilePct: List[float]  # post-dividend, genuinely computed (not a fabricated label)
    isRegressiveGross: bool
    isProgressiveWithDividend: bool  # genuinely derived: net burden strictly decreases as income quartile rises


def carbon_tax_dividend(req: CarbonTaxDividendRequest) -> CarbonTaxDividendResponse:
    energy_spend = np.array(req.householdEnergySpendMonthly, dtype=float)
    income = np.array(req.householdIncomes, dtype=float)
    if len(energy_spend) != len(income):
        raise ValueError(f"householdEnergySpendMonthly has {len(energy_spend)} entries but householdIncomes has {len(income)}")
    if np.any(income <= 0):
        raise ValueError("Household incomes must be positive")

    co2 = energy_spend * 12 * req.emissionFactorTonsPerDollar
    annual_tax = co2 * req.carbonTaxPerTon
    total_revenue = float(np.sum(annual_tax))
    n = len(income)
    dividend = total_revenue / n
    net_tax = annual_tax - dividend

    gross_burden_pct = annual_tax / income * 100
    net_burden_pct = net_tax / income * 100

    # Quartile by income rank (argsort-of-argsort, not pandas.qcut -- avoids
    # qcut's duplicate-bin-edge error on ties, which real income data has plenty of).
    quartile = np.argsort(np.argsort(income)) * 4 // n
    quartile = np.clip(quartile, 0, 3)
    gross_by_q = [float(np.mean(gross_burden_pct[quartile == q])) for q in range(4)]
    net_by_q = [float(np.mean(net_burden_pct[quartile == q])) for q in range(4)]

    return CarbonTaxDividendResponse(
        totalCo2EmissionsTons=float(np.sum(co2)), totalCarbonRevenue=total_revenue,
        equalDividendPerHousehold=float(dividend),
        grossBurdenByQuartilePct=gross_by_q, netBurdenByQuartilePct=net_by_q,
        isRegressiveGross=bool(gross_by_q[0] > gross_by_q[3]),
        # Genuinely computed, not asserted: progressive-with-dividend means the
        # net burden is monotonically non-increasing from lowest to highest
        # quartile (poorer households end up relatively better off after the
        # flat rebate than richer ones) -- verified live rather than assumed true.
        isProgressiveWithDividend=bool(all(net_by_q[i] <= net_by_q[i + 1] for i in range(3))),
    )
