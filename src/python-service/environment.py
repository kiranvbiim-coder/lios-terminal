"""
Environment & Sustainability domain (LIMURIA_ENGINES port plan Phase 9).
Activates the `environment_sustainability` domain (previously seeded but
`active: false` -- a real dashboard and real live FRED/World Bank emissions
data already existed with no domain-specific quant engine behind them).

Ported from engines/47_climate_esg_transition_risk.py (NGFS-inspired carbon
transition risk) and engines/89_carbon_offset_credit_mrv_engine.py (carbon
credit MRV valuation), both read in full first. Both are real, correctly
computed arithmetic, not fake.

One real correction made during porting, not ported as-is: the source's
climate transition risk function derives an EBITDA base via
`revenue_cr * 1200000.0` -- an unexplained magic-number conversion from
Indian-numbering "crores" of revenue to a USD EBITDA figure, with no
documented derivation and no way to independently verify it's correct for
any given company. Rather than porting an unverifiable constant, this
version takes real EBITDA (USD) as an explicit input -- a real, unambiguous
financial figure a consultant would actually have for a real client
company, matching the same "don't port a mock as real, fix it properly"
discipline applied throughout this whole effort. This is inherently a
per-company tool (like Merton/KMV credit risk) -- real bulk aggregate FRED/
World Bank emissions series don't supply company-level scope 1/2/3
emissions or EBITDA, so manual entry of a real client company's own
figures is the correct real-scale input here, not synthetic bulk data.
"""

from pydantic import BaseModel, Field


# ─── Climate transition risk (NGFS-style carbon price exposure) ──────────
class ClimateTransitionRiskRequest(BaseModel):
    scope1EmissionsTons: float = Field(ge=0)
    scope2EmissionsTons: float = Field(ge=0)
    scope3EmissionsTons: float = Field(ge=0)
    ebitdaUsd: float = Field(gt=0)
    carbonPricePerTon: float = Field(default=100.0, gt=0)


class ClimateTransitionRiskResponse(BaseModel):
    totalEmissionsTonsCo2e: float
    carbonIntensityTonsPerMillionUsdEbitda: float
    grossCarbonCostUsd: float
    ebitdaImpactPct: float
    transitionRiskRating: str


def climate_transition_risk(req: ClimateTransitionRiskRequest) -> ClimateTransitionRiskResponse:
    total_emissions = req.scope1EmissionsTons + req.scope2EmissionsTons + req.scope3EmissionsTons
    carbon_intensity = total_emissions / (req.ebitdaUsd / 1e6)
    gross_carbon_cost = total_emissions * req.carbonPricePerTon
    ebitda_impact_pct = (gross_carbon_cost / req.ebitdaUsd) * 100
    rating = "HIGH_EXPOSURE" if ebitda_impact_pct > 5.0 else "MANAGED"
    return ClimateTransitionRiskResponse(
        totalEmissionsTonsCo2e=total_emissions, carbonIntensityTonsPerMillionUsdEbitda=carbon_intensity,
        grossCarbonCostUsd=gross_carbon_cost, ebitdaImpactPct=ebitda_impact_pct, transitionRiskRating=rating,
    )


# ─── Carbon credit MRV (Measurement, Reporting, Verification) valuation ──
class CarbonCreditMrvRequest(BaseModel):
    grossOffsetTons: float = Field(gt=0)
    permanenceRiskPct: float = Field(default=10.0, ge=0, lt=100)
    additionalityScore: float = Field(ge=0, le=1)
    marketPricePerTon: float = Field(gt=0)


class CarbonCreditMrvResponse(BaseModel):
    verifiedNetCreditsTons: float
    totalCreditPortfolioValueUsd: float
    creditQualityRating: str


def carbon_credit_mrv_valuation(req: CarbonCreditMrvRequest) -> CarbonCreditMrvResponse:
    net_offset = req.grossOffsetTons * (1 - req.permanenceRiskPct / 100.0) * req.additionalityScore
    total_value = net_offset * req.marketPricePerTon
    rating = "HIGH_INTEGRITY_ADDITIONAL" if req.additionalityScore > 0.80 else "MODERATE_RISK"
    return CarbonCreditMrvResponse(
        verifiedNetCreditsTons=net_offset, totalCreditPortfolioValueUsd=total_value, creditQualityRating=rating,
    )
