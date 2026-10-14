"""Deterministic research-intelligence primitives for LiOS."""
from __future__ import annotations
from typing import Dict, List, Literal, Optional
import difflib
import re
import numpy as np
from pydantic import BaseModel, Field


class EvidenceItem(BaseModel):
    sourceId: str
    reliabilityScore: float = Field(ge=0.0, le=100.0)
    stance: Literal["supports", "refutes", "neutral"]
    strength: float = Field(default=1.0, ge=0.0, le=1.0)


class Claim(BaseModel):
    claimId: str
    text: str
    evidence: List[EvidenceItem]


class EvidenceGraphRequest(BaseModel):
    claims: List[Claim]


class ClaimAssessment(BaseModel):
    supportScore: float
    refuteScore: float
    netEvidenceScore: float
    contradictory: bool
    sourceCount: int


class EvidenceGraphResponse(BaseModel):
    claims: Dict[str, ClaimAssessment]
    contradictionPairs: List[List[str]]
    weakestClaims: List[str]


def assess_evidence_graph(req: EvidenceGraphRequest) -> EvidenceGraphResponse:
    if not req.claims or len({c.claimId for c in req.claims}) != len(req.claims):
        raise ValueError("Claims must be non-empty and uniquely identified.")
    out = {}
    for c in req.claims:
        sup = ref = 0.0
        seen = set()
        for e in c.evidence:
            if e.sourceId in seen:
                continue
            seen.add(e.sourceId)
            w = e.reliabilityScore / 100 * e.strength
            if e.stance == "supports":
                sup += w
            elif e.stance == "refutes":
                ref += w
        denom = sup + ref
        net = (sup - ref) / denom * 100 if denom > 1e-12 else 0
        out[c.claimId] = ClaimAssessment(supportScore=sup, refuteScore=ref, netEvidenceScore=net,
                                         contradictory=sup > 0.25 and ref > 0.25, sourceCount=len(seen))
    pairs = []
    for i, a in enumerate(req.claims):
        amap = {e.sourceId: e.stance for e in a.evidence}
        for b in req.claims[i + 1:]:
            bmap = {e.sourceId: e.stance for e in b.evidence}
            if any({amap[s], bmap[s]} == {"supports", "refutes"} for s in set(amap) & set(bmap)):
                pairs.append([a.claimId, b.claimId])
    weakest = sorted(out, key=lambda k: (abs(out[k].netEvidenceScore), out[k].sourceCount))[:min(5, len(out))]
    return EvidenceGraphResponse(claims=out, contradictionPairs=pairs, weakestClaims=weakest)


class FilingDiffRequest(BaseModel):
    oldText: str
    newText: str
    maxChanges: int = Field(default=100, ge=1, le=1000)


class FilingDiffResponse(BaseModel):
    similarityRatio: float
    addedSentences: List[str]
    removedSentences: List[str]
    changedNumbers: List[Dict[str, str]]


def _sentences(text: str):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def filing_diff(req: FilingDiffRequest) -> FilingDiffResponse:
    old = _sentences(req.oldText)
    new = _sentences(req.newText)
    matcher = difflib.SequenceMatcher(a=old, b=new, autojunk=False)
    added, removed = [], []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag in {"delete", "replace"}:
            removed.extend(old[i1:i2])
        if tag in {"insert", "replace"}:
            added.extend(new[j1:j2])
    num_re = re.compile(r"(?<!\w)[+-]?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?%?")
    changes = [{"old": o, "new": n} for o, n in zip(num_re.findall(req.oldText), num_re.findall(req.newText)) if o != n]
    return FilingDiffResponse(similarityRatio=float(matcher.ratio()), addedSentences=added[:req.maxChanges],
                              removedSentences=removed[:req.maxChanges], changedNumbers=changes[:req.maxChanges])


class ConsensusDivergenceRequest(BaseModel):
    analystEstimates: List[float]
    internalEstimate: float
    marketPrice: Optional[float] = None


class ConsensusDivergenceResponse(BaseModel):
    consensusMean: float
    consensusMedian: float
    consensusStd: float
    internalZScore: float
    internalVsConsensusPct: float
    dispersionPctOfMean: float
    expectationGapVsMarketPct: Optional[float]


def consensus_divergence(req: ConsensusDivergenceRequest) -> ConsensusDivergenceResponse:
    x = np.asarray(req.analystEstimates, float)
    if len(x) < 3 or not np.all(np.isfinite(x)):
        raise ValueError("At least three finite analyst estimates required.")
    mean, med, sd = float(np.mean(x)), float(np.median(x)), float(np.std(x, ddof=1))
    z = (req.internalEstimate - mean) / sd if sd > 1e-12 else 0
    gap = (req.internalEstimate / mean - 1) * 100 if abs(mean) > 1e-12 else 0
    market = None if req.marketPrice is None else (req.internalEstimate / req.marketPrice - 1) * 100
    return ConsensusDivergenceResponse(consensusMean=mean, consensusMedian=med, consensusStd=sd, internalZScore=float(z),
                                       internalVsConsensusPct=float(gap), dispersionPctOfMean=float(sd / max(abs(mean), 1e-12) * 100),
                                       expectationGapVsMarketPct=None if market is None else float(market))


class Catalyst(BaseModel):
    name: str
    currentValue: float
    triggerValue: float
    direction: Literal["above", "below"]


class CatalystMonitorRequest(BaseModel):
    catalysts: List[Catalyst]


class CatalystMonitorResponse(BaseModel):
    triggered: List[str]
    distanceToTriggerPct: Dict[str, float]


def catalyst_monitor(req: CatalystMonitorRequest) -> CatalystMonitorResponse:
    trig, dist = [], {}
    for c in req.catalysts:
        if c.direction == "above":
            hit = c.currentValue >= c.triggerValue
            d = (c.triggerValue - c.currentValue) / max(abs(c.triggerValue), 1e-12) * 100
        else:
            hit = c.currentValue <= c.triggerValue
            d = (c.currentValue - c.triggerValue) / max(abs(c.triggerValue), 1e-12) * 100
        if hit:
            trig.append(c.name)
        dist[c.name] = float(d)
    return CatalystMonitorResponse(triggered=trig, distanceToTriggerPct=dist)
