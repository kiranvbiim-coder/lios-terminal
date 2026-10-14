"""Advanced climate, carbon and sustainability analytics for LiOS."""
from __future__ import annotations
from typing import Dict, List, Optional
import numpy as np
from pydantic import BaseModel, Field


class FinancedEmissionAsset(BaseModel):
    name: str
    exposure: float = Field(ge=0.0)
    enterpriseValueIncludingCash: float = Field(gt=0.0)
    scope1: float = Field(ge=0.0)
    scope2: float = Field(ge=0.0)
    scope3: float = Field(default=0.0, ge=0.0)
    revenue: Optional[float] = Field(default=None, gt=0.0)


class FinancedEmissionsRequest(BaseModel):
    assets: List[FinancedEmissionAsset]
    includeScope3: bool = True


class FinancedEmissionsResponse(BaseModel):
    financedEmissions: float
    byAsset: Dict[str, float]
    weightedCarbonIntensityPerRevenue: Optional[float]
    dataCoveragePct: float


def financed_emissions(req: FinancedEmissionsRequest) -> FinancedEmissionsResponse:
    if not req.assets:
        raise ValueError("At least one asset required.")
    vals = {}; intensity_num = intensity_den = coverage = 0.0
    for a in req.assets:
        emissions = a.scope1 + a.scope2 + (a.scope3 if req.includeScope3 else 0)
        attribution = min(1.0, a.exposure / a.enterpriseValueIncludingCash)
        vals[a.name] = float(attribution * emissions)
        if a.revenue:
            intensity_num += a.exposure * (emissions / a.revenue)
            intensity_den += a.exposure
            coverage += a.exposure
    total_exposure = sum(a.exposure for a in req.assets)
    return FinancedEmissionsResponse(financedEmissions=float(sum(vals.values())), byAsset=vals,
                                     weightedCarbonIntensityPerRevenue=None if intensity_den <= 0 else float(intensity_num / intensity_den),
                                     dataCoveragePct=float(coverage / total_exposure * 100) if total_exposure > 0 else 0.0)


class ClimateAsset(BaseModel):
    name: str
    marketValue: float
    scope12Tonnes: float = Field(ge=0.0)
    annualRevenue: float = Field(gt=0.0)
    ebitdaMarginPct: float
    carbonCostPassThroughPct: float = Field(default=0.0, ge=0.0, le=100.0)
    physicalHazardExposurePct: float = Field(default=0.0, ge=0.0, le=100.0)
    physicalDamageSensitivity: float = Field(default=0.0, ge=0.0)
    valuationMultiple: float = Field(default=10.0, ge=0.0)


class ClimateScenario(BaseModel):
    name: str
    carbonPricePerTonne: float = Field(ge=0.0)
    demandShockPct: float = 0.0
    physicalHazardSeverity: float = Field(default=0.0, ge=0.0)


class ClimateVaRRequest(BaseModel):
    assets: List[ClimateAsset]
    scenarios: List[ClimateScenario]


class ClimateScenarioResult(BaseModel):
    portfolioValueImpact: float
    portfolioValueImpactPct: float
    assetImpacts: Dict[str, float]


class ClimateVaRResponse(BaseModel):
    scenarios: Dict[str, ClimateScenarioResult]
    worstScenario: str
    climateVaR: float
    climateVaRPct: float


def climate_var(req: ClimateVaRRequest) -> ClimateVaRResponse:
    if not req.assets or not req.scenarios:
        raise ValueError("Assets and climate scenarios are required.")
    total = sum(a.marketValue for a in req.assets)
    if total <= 0:
        raise ValueError("Portfolio market value must be positive.")
    out = {}
    for s in req.scenarios:
        impacts = {}
        for a in req.assets:
            gross_carbon = a.scope12Tonnes * s.carbonPricePerTonne
            retained = gross_carbon * (1 - a.carbonCostPassThroughPct / 100)
            demand_ebitda = a.annualRevenue * (s.demandShockPct / 100) * (a.ebitdaMarginPct / 100)
            physical = a.marketValue * (a.physicalHazardExposurePct / 100) * s.physicalHazardSeverity * a.physicalDamageSensitivity
            value_impact = (-(retained) - demand_ebitda) * a.valuationMultiple - physical
            impacts[a.name] = float(value_impact)
        pi = float(sum(impacts.values()))
        out[s.name] = ClimateScenarioResult(portfolioValueImpact=pi, portfolioValueImpactPct=pi / total * 100, assetImpacts=impacts)
    worst = min(out, key=lambda n: out[n].portfolioValueImpact)
    var = max(0.0, -out[worst].portfolioValueImpact)
    return ClimateVaRResponse(scenarios=out, worstScenario=worst, climateVaR=var, climateVaRPct=var / total * 100)


class AbatementProject(BaseModel):
    name: str
    annualAbatementTonnes: float = Field(gt=0.0)
    annualizedCost: float
    implementationCapex: float = Field(default=0.0, ge=0.0)


class AbatementCurveRequest(BaseModel):
    projects: List[AbatementProject]
    carbonPricePerTonne: Optional[float] = Field(default=None, ge=0.0)
    abatementTargetTonnes: Optional[float] = Field(default=None, ge=0.0)


class AbatementPoint(BaseModel):
    name: str
    marginalCostPerTonne: float
    annualAbatementTonnes: float
    cumulativeAbatementTonnes: float
    economicallyAttractive: Optional[bool]


class AbatementCurveResponse(BaseModel):
    curve: List[AbatementPoint]
    targetCost: Optional[float]
    targetAchievable: Optional[bool]


def marginal_abatement_curve(req: AbatementCurveRequest) -> AbatementCurveResponse:
    if not req.projects:
        raise ValueError("At least one abatement project required.")
    rows = sorted(req.projects, key=lambda p: p.annualizedCost / p.annualAbatementTonnes)
    curve = []; cum = target_cost = 0.0; remaining = req.abatementTargetTonnes
    for p in rows:
        mc = p.annualizedCost / p.annualAbatementTonnes; cum += p.annualAbatementTonnes
        attractive = None if req.carbonPricePerTonne is None else mc <= req.carbonPricePerTonne
        curve.append(AbatementPoint(name=p.name, marginalCostPerTonne=float(mc), annualAbatementTonnes=p.annualAbatementTonnes,
                                   cumulativeAbatementTonnes=cum, economicallyAttractive=attractive))
        if remaining is not None and remaining > 0:
            take = min(remaining, p.annualAbatementTonnes); target_cost += take * mc; remaining -= take
    return AbatementCurveResponse(curve=curve, targetCost=None if req.abatementTargetTonnes is None else float(target_cost),
                                  targetAchievable=None if remaining is None else remaining <= 1e-9)


class TransitionPathwayRequest(BaseModel):
    baseEmissions: float = Field(gt=0.0)
    years: List[int]
    emissionsTargets: List[float]
    carbonPrices: List[float]
    revenueForecast: Optional[List[float]] = None


class TransitionPathwayResponse(BaseModel):
    annualReductionPct: List[float]
    cumulativeCarbonCost: float
    emissionsIntensity: Optional[List[float]]
    targetCagrPct: float


def transition_pathway(req: TransitionPathwayRequest) -> TransitionPathwayResponse:
    years = np.asarray(req.years, int); e = np.asarray(req.emissionsTargets, float); cp = np.asarray(req.carbonPrices, float)
    if len(years) < 2 or e.shape != years.shape or cp.shape != years.shape or np.any(np.diff(years) <= 0) or np.any(e < 0) or np.any(cp < 0):
        raise ValueError("Transition pathway vectors invalid.")
    reductions = []; prev = req.baseEmissions; cost = 0.0
    for i in range(len(years)):
        reductions.append(float((1 - e[i] / prev) * 100 if prev > 0 else 0))
        span = (years[i] - years[i - 1]) if i > 0 else 1
        cost += e[i] * cp[i] * span; prev = e[i]
    span = years[-1] - years[0]
    cagr = (e[-1] / e[0]) ** (1 / span) - 1 if span > 0 and e[0] > 0 and e[-1] > 0 else -1.0
    intensity = None
    if req.revenueForecast is not None:
        rev = np.asarray(req.revenueForecast, float)
        if rev.shape != e.shape or np.any(rev <= 0):
            raise ValueError("Revenue forecast must align and be positive.")
        intensity = (e / rev).tolist()
    return TransitionPathwayResponse(annualReductionPct=reductions, cumulativeCarbonCost=float(cost), emissionsIntensity=intensity, targetCagrPct=float(cagr * 100))
