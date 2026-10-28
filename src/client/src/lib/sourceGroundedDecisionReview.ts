import type {TrustManifest} from "@shared/trustContracts";
import { recordedSourceAccess } from "./evidenceExceptions";

export type DecisionReviewDraft = {
  claimId:string;
  prompt:string;
  sourceCount:number;
  unresolvedAssumptions:number;
  warnings:number;
};
export type DecisionReviewAvailability = {status:"ready";draft:DecisionReviewDraft} |
  {status:"blocked";reason:string};

/**
 * C05: a user-initiated *proposal to review* a recorded claim, not a
 * recommendation, an agent execution, a live entitlement check or permission.
 * No provider URI, raw source data, assumptions' values or internal file paths
 * are transmitted in the prefilled Chat prompt.
 */
export function sourceGroundedDecisionReview(
  manifest:TrustManifest, claimId:string,
):DecisionReviewAvailability {
  const claim=manifest.claims.find(item=>item.claimId===claimId);
  if (!claim) return {status:"blocked",reason:"Claim was not recorded in this review."};
  if (claim.status!=="supported" && claim.status!=="partial")
    return {status:"blocked",reason:"This claim is unresolved or conflicted. Inspect its evidence before requesting decision options."};
  if (manifest.summary.conflictState==="material" || manifest.summary.conflictState==="minor")
    return {status:"blocked",reason:"The recorded source conflict requires review before proposing options."};
  const refs=[...new Set(claim.sourceRefs)];
  if(!refs.length) return {status:"blocked",reason:"No exact recorded evidence references support this claim."};
  const byRef=new Map<string,typeof manifest.evidence>();
  for(const observation of manifest.evidence) {
    const group=byRef.get(observation.sourceRef) ?? [];
    group.push(observation);
    byRef.set(observation.sourceRef,group);
  }
  let sources=0;
  for(const ref of refs) {
    const observations=byRef.get(ref) ?? [];
    // All referenced observations must be explicit records, rather than
    // untrusted AI-only prose or a single convenient accessible observation.
    if(!observations.length || observations.every(ob=>ob.kind==="ai"))
      return {status:"blocked",reason:"Some cited evidence is missing or only AI-generated."};
    const dataObservations=observations.filter(ob=>ob.kind!=="ai");
    if(dataObservations.some(ob=>recordedSourceAccess(ob).level!=="recorded"))
      return {status:"blocked",reason:"Recorded source access is denied, restricted, or not established. Recheck permissions."};
    sources+=dataObservations.length;
  }
  const assumptions=new Set(manifest.assumptions.map(a=>a.ref));
  const missing=claim.assumptionRefs.filter(ref=>!assumptions.has(ref)).length;
  // IDs are bounded by the P3 schema. Neither source URI nor user data is
  // copied to the prompt; server/AI must re-evaluate rights and evidence.
  const prompt=[
    "Review decision options for the selected recorded claim in this conversation.",
    "Recorded claim ID: "+claim.claimId+". Recorded trust review ID: "+manifest.trustId+".",
    "Inspect its attached evidence, constraints and assumptions, and explicitly distinguish observations from inferences.",
    missing>0 ? "There are "+missing+" unresolved assumption references; request missing inputs instead of computing an answer." : "Recheck any recorded assumption values and their uncertainty before relying on them.",
    "Recheck CURRENT source permission, date, conflicts, alternative explanations and missing evidence. This historical trust record does not establish live access.",
    "Propose alternatives and trade-offs only when evidence permits. Do not claim verified exposure, causal impact, source rights or a numeric forecast without a current deterministic receipt.",
    "Do not execute tools, create automation, save an Artifact, send data externally or apply recommendations without explicit user approval.",
  ].join("\n");
  return {status:"ready",draft:{claimId,prompt,sourceCount:sources,
    unresolvedAssumptions:missing,warnings:manifest.warnings.length+manifest.missing.length}};
}
