"""LiOS Decision Supercomputer primitives: model tournament, scenario graph, uncertainty, VOI and MCDA."""
from __future__ import annotations
from typing import Dict, List, Literal, Optional
import math
import numpy as np
from pydantic import BaseModel, Field


class ModelCandidate(BaseModel):
    name: str
    estimate: float
    lowerBound: Optional[float] = None
    upperBound: Optional[float] = None
    assuranceScore: float = Field(ge=0.0, le=100.0)
    validationScore: float = Field(ge=0.0, le=100.0)
    dataQualityScore: float = Field(ge=0.0, le=100.0)
    suitabilityScore: float = Field(default=80.0, ge=0.0, le=100.0)
    historicalRmse: Optional[float] = Field(default=None, gt=0.0)


class ModelTournamentRequest(BaseModel):
    candidates: List[ModelCandidate]
    disagreementWarningPct: float = Field(default=20.0, ge=0.0)
    outlierMadThreshold: float = Field(default=3.5, gt=0.0)


class ModelTournamentResponse(BaseModel):
    weightedEstimate: float
    weightedLowerBound: float
    weightedUpperBound: float
    weights: Dict[str, float]
    disagreementPctOfEstimate: float
    disagreementBand: str
    outlierModels: List[str]
    consensusModels: List[str]
    effectiveModelCount: float


def model_tournament(req: ModelTournamentRequest) -> ModelTournamentResponse:
    c = req.candidates
    if len(c) < 2 or len({x.name for x in c}) != len(c):
        raise ValueError("Model tournament requires at least two uniquely named candidates.")
    est = np.array([x.estimate for x in c], float)
    if not np.all(np.isfinite(est)):
        raise ValueError("Model estimates must be finite.")
    med = float(np.median(est)); mad = float(np.median(np.abs(est - med))); scale = 1.4826 * mad
    outlier = np.zeros(len(c), bool)
    if scale > 1e-12:
        outlier = np.abs(est - med) / scale > req.outlierMadThreshold
    rmses = [x.historicalRmse for x in c if x.historicalRmse is not None]
    rmse_ref = float(np.median(rmses)) if rmses else None
    quality = []
    for i, x in enumerate(c):
        q = ((max(x.assuranceScore, 1e-6) / 100) * (max(x.validationScore, 1e-6) / 100) *
             (max(x.dataQualityScore, 1e-6) / 100) * (max(x.suitabilityScore, 1e-6) / 100)) ** 0.25
        if x.historicalRmse is not None and rmse_ref is not None:
            q *= 1 / (1 + x.historicalRmse / max(rmse_ref, 1e-12))
        if outlier[i]:
            q *= 0.001
        quality.append(q)
    q = np.asarray(quality, float)
    if q.sum() <= 1e-12:
        raise ValueError("No tournament candidate has usable quality weight.")
    w = q / q.sum(); estimate = float(w @ est)
    lowers = np.array([x.lowerBound if x.lowerBound is not None else x.estimate for x in c], float)
    uppers = np.array([x.upperBound if x.upperBound is not None else x.estimate for x in c], float)
    disagreement = math.sqrt(float(w @ ((est - estimate) ** 2))) / max(abs(estimate), 1e-12) * 100
    band = "high" if disagreement >= req.disagreementWarningPct else "moderate" if disagreement >= req.disagreementWarningPct / 2 else "low"
    return ModelTournamentResponse(weightedEstimate=estimate, weightedLowerBound=float(w @ lowers), weightedUpperBound=float(w @ uppers),
                                   weights=dict(zip([x.name for x in c], w.tolist())), disagreementPctOfEstimate=disagreement,
                                   disagreementBand=band, outlierModels=[c[i].name for i in range(len(c)) if outlier[i]],
                                   consensusModels=[c[i].name for i in range(len(c)) if not outlier[i]], effectiveModelCount=float(1 / np.sum(w * w)))


class ScenarioNode(BaseModel):
    name: str
    baseline: float
    domain: str = "general"


class ScenarioEdge(BaseModel):
    source: str
    target: str
    coefficient: float
    mode: Literal["absolute", "elasticity", "percent_to_absolute"] = "absolute"
    label: Optional[str] = None


class ScenarioShock(BaseModel):
    node: str
    change: float


class ScenarioGraphRequest(BaseModel):
    nodes: List[ScenarioNode]
    edges: List[ScenarioEdge]
    shocks: List[ScenarioShock]


class ScenarioGraphResponse(BaseModel):
    shockedValues: Dict[str, float]
    totalChanges: Dict[str, float]
    directShocks: Dict[str, float]
    domainImpacts: Dict[str, float]
    propagationOrder: List[str]


def propagate_scenario(req: ScenarioGraphRequest) -> ScenarioGraphResponse:
    nodes = {n.name: n for n in req.nodes}
    if not nodes or len(nodes) != len(req.nodes):
        raise ValueError("Scenario nodes must be non-empty and unique.")
    incoming = {n: [] for n in nodes}; outgoing = {n: [] for n in nodes}; indegree = {n: 0 for n in nodes}
    for e in req.edges:
        if e.source not in nodes or e.target not in nodes:
            raise ValueError(f"Unknown scenario edge {e.source}->{e.target}.")
        if e.source == e.target:
            raise ValueError("Self-referential scenario edges are not allowed.")
        outgoing[e.source].append(e); incoming[e.target].append(e); indegree[e.target] += 1
    queue = sorted([n for n, d in indegree.items() if d == 0]); order = []
    while queue:
        n = queue.pop(0); order.append(n)
        for e in outgoing[n]:
            indegree[e.target] -= 1
            if indegree[e.target] == 0:
                queue.append(e.target); queue.sort()
    if len(order) != len(nodes):
        raise ValueError("Scenario graph contains a cycle; use an acyclic calibrated transmission graph.")
    direct = {n: 0.0 for n in nodes}
    for s in req.shocks:
        if s.node not in nodes:
            raise ValueError(f"Unknown shock node {s.node}.")
        direct[s.node] += s.change
    changes = dict(direct)
    for target in order:
        for e in incoming[target]:
            source_change = changes[e.source]; source_base = nodes[e.source].baseline; target_base = nodes[target].baseline
            if e.mode == "absolute":
                transmitted = e.coefficient * source_change
            elif e.mode == "elasticity":
                if abs(source_base) < 1e-12:
                    raise ValueError(f"Elasticity edge source baseline is zero: {e.source}.")
                transmitted = target_base * e.coefficient * (source_change / source_base)
            else:
                transmitted = e.coefficient * (source_change / 100.0)
            changes[target] += transmitted
    values = {n: nodes[n].baseline + changes[n] for n in nodes}; domains = {}
    for n, node in nodes.items():
        domains[node.domain] = domains.get(node.domain, 0.0) + changes[n]
    return ScenarioGraphResponse(shockedValues=values, totalChanges=changes, directShocks=direct, domainImpacts=domains, propagationOrder=order)


class UncertaintyFactor(BaseModel):
    name: str
    standardDeviation: float = Field(ge=0.0)
    sensitivity: float
    category: Literal["data", "model", "market", "scenario", "parameter"] = "parameter"


class LinearUncertaintyRequest(BaseModel):
    centralEstimate: float
    factors: List[UncertaintyFactor]
    correlationMatrix: Optional[List[List[float]]] = None
    confidencePct: float = Field(default=95.0, ge=50.0, le=99.99)


class LinearUncertaintyResponse(BaseModel):
    centralEstimate: float
    standardDeviation: float
    lowerBound: float
    upperBound: float
    varianceContributionsPct: Dict[str, float]
    categoryVarianceContributionsPct: Dict[str, float]
    dominantUncertainty: Optional[str]


def linear_uncertainty(req: LinearUncertaintyRequest) -> LinearUncertaintyResponse:
    n = len(req.factors)
    if n == 0:
        return LinearUncertaintyResponse(centralEstimate=req.centralEstimate, standardDeviation=0, lowerBound=req.centralEstimate,
                                         upperBound=req.centralEstimate, varianceContributionsPct={}, categoryVarianceContributionsPct={}, dominantUncertainty=None)
    sig = np.array([f.standardDeviation for f in req.factors], float); sens = np.array([f.sensitivity for f in req.factors], float)
    C = np.eye(n) if req.correlationMatrix is None else np.asarray(req.correlationMatrix, float)
    if C.shape != (n, n) or not np.allclose(C, C.T, atol=1e-10) or float(np.linalg.eigvalsh(C).min()) < -1e-8 or np.any(np.abs(C) > 1 + 1e-9):
        raise ValueError("Uncertainty correlation matrix must be valid PSD correlation.")
    cov = np.outer(sig, sig) * C; var = float(sens @ cov @ sens); sd = math.sqrt(max(0, var))
    contrib = sens * (cov @ sens); pct = np.zeros(n) if var <= 1e-18 else contrib / var * 100; cats = {}
    for i, f in enumerate(req.factors):
        cats[f.category] = cats.get(f.category, 0.0) + float(pct[i])
    from scipy.stats import norm
    z = float(norm.ppf(0.5 + req.confidencePct / 200)); dominant = req.factors[int(np.argmax(np.abs(pct)))].name
    return LinearUncertaintyResponse(centralEstimate=req.centralEstimate, standardDeviation=sd, lowerBound=req.centralEstimate - z * sd,
                                     upperBound=req.centralEstimate + z * sd, varianceContributionsPct=dict(zip([f.name for f in req.factors], pct.tolist())),
                                     categoryVarianceContributionsPct=cats, dominantUncertainty=dominant)


class DecisionAlternative(BaseModel):
    name: str
    payoffs: List[float]


class ValueOfInformationRequest(BaseModel):
    stateNames: List[str]
    stateProbabilities: List[float]
    alternatives: List[DecisionAlternative]


class ValueOfInformationResponse(BaseModel):
    expectedValues: Dict[str, float]
    bestAlternative: str
    bestExpectedValue: float
    expectedValuePerfectInformation: float
    valueOfPerfectInformation: float
    maximumRegret: Dict[str, float]
    minimaxRegretAlternative: str


def value_of_information(req: ValueOfInformationRequest) -> ValueOfInformationResponse:
    p = np.asarray(req.stateProbabilities, float); n = len(req.stateNames)
    if n < 2 or p.shape != (n,) or np.any(p < 0) or abs(float(p.sum()) - 1) > 1e-6:
        raise ValueError("State probabilities must align and sum to 1.")
    if len(req.alternatives) < 2 or any(len(a.payoffs) != n for a in req.alternatives):
        raise ValueError("Each alternative needs one payoff per state.")
    A = np.array([a.payoffs for a in req.alternatives], float); ev = A @ p; best_i = int(np.argmax(ev))
    perfect = float(np.max(A, axis=0) @ p); regrets = np.max(A, axis=0)[None, :] - A; maxreg = np.max(regrets, axis=1); mm = int(np.argmin(maxreg))
    return ValueOfInformationResponse(expectedValues=dict(zip([a.name for a in req.alternatives], ev.tolist())), bestAlternative=req.alternatives[best_i].name,
                                      bestExpectedValue=float(ev[best_i]), expectedValuePerfectInformation=perfect, valueOfPerfectInformation=float(perfect - ev[best_i]),
                                      maximumRegret=dict(zip([a.name for a in req.alternatives], maxreg.tolist())), minimaxRegretAlternative=req.alternatives[mm].name)


class Criterion(BaseModel):
    name: str
    weight: float = Field(gt=0.0)
    direction: Literal["maximize", "minimize"] = "maximize"


class MCDAAlternative(BaseModel):
    name: str
    values: Dict[str, float]


class MCDARequest(BaseModel):
    criteria: List[Criterion]
    alternatives: List[MCDAAlternative]


class MCDAResponse(BaseModel):
    scores: Dict[str, float]
    ranking: List[str]
    normalizedCriteriaWeights: Dict[str, float]


def topsis_mcda(req: MCDARequest) -> MCDAResponse:
    if len(req.criteria) < 2 or len(req.alternatives) < 2:
        raise ValueError("MCDA requires >=2 criteria and alternatives.")
    names = [c.name for c in req.criteria]
    if len(set(names)) != len(names) or len({a.name for a in req.alternatives}) != len(req.alternatives):
        raise ValueError("Criteria/alternative names must be unique.")
    X = np.array([[a.values[c] for c in names] for a in req.alternatives], float); norm = np.sqrt(np.sum(X * X, axis=0)); norm = np.where(norm < 1e-12, 1, norm)
    W = np.array([c.weight for c in req.criteria], float); W = W / W.sum(); V = X / norm * W
    best = np.empty(len(names)); worst = np.empty(len(names))
    for j, c in enumerate(req.criteria):
        if c.direction == "maximize":
            best[j], worst[j] = np.max(V[:, j]), np.min(V[:, j])
        else:
            best[j], worst[j] = np.min(V[:, j]), np.max(V[:, j])
    db = np.sqrt(np.sum((V - best) ** 2, axis=1)); dw = np.sqrt(np.sum((V - worst) ** 2, axis=1)); score = np.where(db + dw > 1e-12, dw / (db + dw), 0.5)
    order = np.argsort(-score)
    return MCDAResponse(scores=dict(zip([a.name for a in req.alternatives], score.tolist())), ranking=[req.alternatives[i].name for i in order],
                        normalizedCriteriaWeights=dict(zip(names, W.tolist())))
