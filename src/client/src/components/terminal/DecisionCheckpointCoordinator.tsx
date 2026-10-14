import { useEffect, useRef } from "react";
import { ensureDecisionActivationCheckpoint } from "@/lib/terminalDecisionCheckpoints";
import { loadDecisionObjects, subscribeDecisionObjects, type DecisionObject } from "@/lib/terminalDecisionObjects";

function fingerprint(decisions: readonly DecisionObject[]): string {
  return decisions.map((decision) => `${decision.id}:${decision.status}:${decision.decidedAt ?? 0}`).sort().join("|");
}

export default function DecisionCheckpointCoordinator() {
  const seen = useRef("");

  useEffect(() => {
    const capture = (decisions: DecisionObject[]) => {
      const nextFingerprint = fingerprint(decisions);
      if (seen.current === nextFingerprint) return;
      seen.current = nextFingerprint;
      for (const decision of decisions) ensureDecisionActivationCheckpoint(decision);
    };
    capture(loadDecisionObjects());
    return subscribeDecisionObjects(capture);
  }, []);

  return null;
}
