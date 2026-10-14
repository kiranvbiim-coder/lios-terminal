"""Advanced supply-chain optimization and disruption simulation for LiOS."""
from __future__ import annotations
from typing import Dict, List, Optional
import numpy as np
from pydantic import BaseModel, Field
from scipy import optimize


class Facility(BaseModel):
    name: str
    fixedCost: float = Field(ge=0.0)
    capacity: float = Field(gt=0.0)


class FacilityLocationRequest(BaseModel):
    facilities: List[Facility]
    customerNames: List[str]
    demand: List[float]
    transportCost: List[List[float]]
    maxOpenFacilities: Optional[int] = Field(default=None, ge=1)


class FacilityLocationResponse(BaseModel):
    openFacilities: List[str]
    shipment: Dict[str, Dict[str, float]]
    totalFixedCost: float
    totalTransportCost: float
    totalCost: float
    capacityUtilizationPct: Dict[str, float]


def facility_location_milp(req: FacilityLocationRequest) -> FacilityLocationResponse:
    F, C = req.facilities, req.customerNames; nf, nc = len(F), len(C)
    if nf < 1 or nc < 1 or len(set(f.name for f in F)) != nf or len(set(C)) != nc:
        raise ValueError("Facility/customer names must be unique and non-empty.")
    d = np.asarray(req.demand, float); tc = np.asarray(req.transportCost, float)
    if d.shape != (nc,) or tc.shape != (nf, nc) or np.any(d < 0) or np.any(tc < 0) or not np.all(np.isfinite(tc)):
        raise ValueError("Demand/transport dimensions invalid.")
    if sum(f.capacity for f in F) + 1e-9 < float(d.sum()):
        raise ValueError("Total facility capacity is below total demand.")
    nvar = nf + nf * nc; c = np.zeros(nvar); c[:nf] = [f.fixedCost for f in F]; c[nf:] = tc.reshape(-1)
    integrality = np.zeros(nvar, int); integrality[:nf] = 1
    lb = np.zeros(nvar); ub = np.full(nvar, np.inf); ub[:nf] = 1
    rows, lower, upper = [], [], []
    for j in range(nc):
        row = np.zeros(nvar)
        for i in range(nf):
            row[nf + i * nc + j] = 1
        rows.append(row); lower.append(d[j]); upper.append(d[j])
    for i, f in enumerate(F):
        row = np.zeros(nvar); row[nf + i * nc:nf + (i + 1) * nc] = 1; row[i] = -f.capacity
        rows.append(row); lower.append(-np.inf); upper.append(0)
    if req.maxOpenFacilities is not None:
        row = np.zeros(nvar); row[:nf] = 1
        rows.append(row); lower.append(-np.inf); upper.append(req.maxOpenFacilities)
    cons = optimize.LinearConstraint(np.vstack(rows), np.array(lower), np.array(upper))
    res = optimize.milp(c, integrality=integrality, bounds=optimize.Bounds(lb, ub), constraints=cons,
                        options={"time_limit": 30.0, "mip_rel_gap": 1e-9})
    if not res.success or res.x is None:
        raise ValueError(f"Facility-location MILP failed: {res.message}")
    y = res.x[:nf]; q = res.x[nf:].reshape(nf, nc); opens = [F[i].name for i in range(nf) if y[i] > 0.5]
    shipment = {F[i].name: {C[j]: float(q[i, j]) for j in range(nc) if q[i, j] > 1e-9} for i in range(nf)}
    fixed = sum(F[i].fixedCost for i in range(nf) if y[i] > 0.5); trans = float(np.sum(q * tc))
    return FacilityLocationResponse(openFacilities=opens, shipment=shipment, totalFixedCost=float(fixed), totalTransportCost=trans,
                                    totalCost=float(fixed + trans), capacityUtilizationPct={F[i].name: float(q[i].sum() / F[i].capacity * 100) for i in range(nf)})


class StochasticInventoryRequest(BaseModel):
    demandScenarios: List[float]
    scenarioProbabilities: Optional[List[float]] = None
    unitPurchaseCost: float = Field(ge=0.0)
    holdingCostPerUnit: float = Field(ge=0.0)
    stockoutCostPerUnit: float = Field(ge=0.0)
    salvageValuePerUnit: float = 0.0
    maxOrderQuantity: Optional[float] = Field(default=None, gt=0.0)


class StochasticInventoryResponse(BaseModel):
    optimalOrderQuantity: float
    expectedTotalCost: float
    expectedShortage: float
    expectedLeftover: float
    serviceProbabilityPct: float


def stochastic_inventory(req: StochasticInventoryRequest) -> StochasticInventoryResponse:
    demand = np.asarray(req.demandScenarios, float)
    if len(demand) < 5 or np.any(demand < 0) or not np.all(np.isfinite(demand)):
        raise ValueError("At least five finite non-negative demand scenarios required.")
    p = np.ones(len(demand)) / len(demand) if req.scenarioProbabilities is None else np.asarray(req.scenarioProbabilities, float)
    if p.shape != demand.shape or np.any(p < 0) or abs(float(p.sum()) - 1) > 1e-6:
        raise ValueError("Scenario probabilities must align and sum to 1.")
    maxq = req.maxOrderQuantity or max(float(np.max(demand)) * 1.5, 1.0)
    def components(q):
        left = np.maximum(q - demand, 0); short = np.maximum(demand - q, 0)
        cost = req.unitPurchaseCost * q + float(p @ (left * req.holdingCostPerUnit + short * req.stockoutCostPerUnit - left * req.salvageValuePerUnit))
        return cost, float(p @ short), float(p @ left), float(p @ (demand <= q)) * 100
    res = optimize.minimize_scalar(lambda q: components(q)[0], bounds=(0, maxq), method="bounded", options={"xatol": 1e-9})
    if not res.success:
        raise ValueError("Stochastic inventory optimization failed.")
    cost, short, left, service = components(float(res.x))
    return StochasticInventoryResponse(optimalOrderQuantity=float(res.x), expectedTotalCost=cost, expectedShortage=short,
                                       expectedLeftover=left, serviceProbabilityPct=service)


class Supplier(BaseModel):
    name: str
    unitCost: float = Field(ge=0.0)
    capacity: float = Field(gt=0.0)
    disruptionProbabilityPct: float = Field(default=0.0, ge=0.0, le=100.0)
    emissionsPerUnit: float = Field(default=0.0, ge=0.0)
    minimumAllocation: float = Field(default=0.0, ge=0.0)


class SupplierPortfolioRequest(BaseModel):
    suppliers: List[Supplier]
    demand: float = Field(gt=0.0)
    riskPenaltyPerExpectedLostUnit: float = Field(default=0.0, ge=0.0)
    carbonPricePerEmissionUnit: float = Field(default=0.0, ge=0.0)
    concentrationPenalty: float = Field(default=0.0, ge=0.0)
    maxSupplierShare: float = Field(default=1.0, gt=0.0, le=1.0)


class SupplierPortfolioResponse(BaseModel):
    allocations: Dict[str, float]
    allocationSharesPct: Dict[str, float]
    expectedProcurementCost: float
    expectedDisruptionLossUnits: float
    emissions: float
    herfindahlIndex: float
    objectiveValue: float


def supplier_portfolio(req: SupplierPortfolioRequest) -> SupplierPortfolioResponse:
    s = req.suppliers; n = len(s)
    if n < 1 or len({x.name for x in s}) != n:
        raise ValueError("Suppliers must be unique and non-empty.")
    if sum(x.capacity for x in s) + 1e-9 < req.demand:
        raise ValueError("Supplier capacity is below demand.")
    cost = np.array([x.unitCost for x in s]); pd = np.array([x.disruptionProbabilityPct / 100 for x in s]); em = np.array([x.emissionsPerUnit for x in s])
    lo = np.array([x.minimumAllocation for x in s]); hi = np.array([min(x.capacity, req.maxSupplierShare * req.demand) for x in s])
    if np.any(lo > hi) or lo.sum() > req.demand + 1e-9:
        raise ValueError("Supplier minimum/max allocations are infeasible.")
    def obj(x):
        shares = x / req.demand
        return float(x @ cost + req.riskPenaltyPerExpectedLostUnit * (x @ pd) + req.carbonPricePerEmissionUnit * (x @ em) + req.concentrationPenalty * np.sum(shares * shares))
    lp = optimize.linprog(np.zeros(n), A_eq=np.ones((1, n)), b_eq=[req.demand], bounds=list(zip(lo, hi)), method="highs")
    if not lp.success:
        raise ValueError("Supplier allocation constraints are infeasible.")
    res = optimize.minimize(obj, lp.x, method="SLSQP", bounds=list(zip(lo, hi)), constraints=[{"type": "eq", "fun": lambda x: float(x.sum() - req.demand)}],
                            options={"ftol": 1e-12, "maxiter": 2000})
    if not res.success:
        raise ValueError(f"Supplier portfolio optimization failed: {res.message}")
    x = np.asarray(res.x); sh = x / req.demand
    return SupplierPortfolioResponse(allocations=dict(zip([z.name for z in s], x.tolist())), allocationSharesPct=dict(zip([z.name for z in s], (sh * 100).tolist())),
                                     expectedProcurementCost=float(x @ cost), expectedDisruptionLossUnits=float(x @ pd), emissions=float(x @ em),
                                     herfindahlIndex=float(np.sum(sh * sh)), objectiveValue=obj(x))


class DisruptionSupplier(BaseModel):
    name: str
    allocation: float = Field(ge=0.0)
    disruptionProbabilityPct: float = Field(ge=0.0, le=100.0)
    recoveryDaysMean: float = Field(default=30.0, gt=0.0)
    recoveryDaysStd: float = Field(default=10.0, ge=0.0)
    backupCostPremiumPct: float = Field(default=20.0, ge=0.0)


class DisruptionSimulationRequest(BaseModel):
    suppliers: List[DisruptionSupplier]
    dailyDemand: float = Field(gt=0.0)
    inventoryBufferUnits: float = Field(default=0.0, ge=0.0)
    unitBaseCost: float = Field(default=1.0, ge=0.0)
    simulations: int = Field(default=20000, ge=1000, le=200000)
    seed: int


class DisruptionSimulationResponse(BaseModel):
    expectedShortfallUnits: float
    p95ShortfallUnits: float
    expectedIncrementalCost: float
    p95IncrementalCost: float
    probabilityAnyDisruptionPct: float
    seed: int


def disruption_simulation(req: DisruptionSimulationRequest) -> DisruptionSimulationResponse:
    if not req.suppliers:
        raise ValueError("At least one supplier required.")
    rng = np.random.default_rng(req.seed); ns = req.simulations; short = np.zeros(ns); cost = np.zeros(ns); anyd = np.zeros(ns, bool)
    if sum(s.allocation for s in req.suppliers) <= 0:
        raise ValueError("Total supplier allocation must be positive.")
    for s in req.suppliers:
        events = rng.random(ns) < s.disruptionProbabilityPct / 100; anyd |= events
        days = np.maximum(0, rng.normal(s.recoveryDaysMean, s.recoveryDaysStd, ns)); lost = s.allocation * days * events
        short += lost; cost += lost * req.unitBaseCost * s.backupCostPremiumPct / 100
    short = np.maximum(0, short - req.inventoryBufferUnits)
    return DisruptionSimulationResponse(expectedShortfallUnits=float(np.mean(short)), p95ShortfallUnits=float(np.percentile(short, 95)),
                                        expectedIncrementalCost=float(np.mean(cost)), p95IncrementalCost=float(np.percentile(cost, 95)),
                                        probabilityAnyDisruptionPct=float(np.mean(anyd) * 100), seed=req.seed)


class ResilienceFrontierRequest(SupplierPortfolioRequest):
    riskPenaltyGrid: List[float] = Field(default_factory=lambda: [0, 1, 5, 10, 25, 50])


class ResilienceFrontierPoint(BaseModel):
    riskPenalty: float
    objectiveValue: float
    procurementCost: float
    expectedDisruptionLossUnits: float
    herfindahlIndex: float
    allocations: Dict[str, float]


class ResilienceFrontierResponse(BaseModel):
    points: List[ResilienceFrontierPoint]


def resilience_frontier(req: ResilienceFrontierRequest) -> ResilienceFrontierResponse:
    points = []
    for rp in req.riskPenaltyGrid:
        payload = req.model_dump(); payload["riskPenaltyPerExpectedLostUnit"] = rp; payload.pop("riskPenaltyGrid", None)
        out = supplier_portfolio(SupplierPortfolioRequest(**payload))
        points.append(ResilienceFrontierPoint(riskPenalty=float(rp), objectiveValue=out.objectiveValue, procurementCost=out.expectedProcurementCost,
                                              expectedDisruptionLossUnits=out.expectedDisruptionLossUnits, herfindahlIndex=out.herfindahlIndex, allocations=out.allocations))
    return ResilienceFrontierResponse(points=points)
