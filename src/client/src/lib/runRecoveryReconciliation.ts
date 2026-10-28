/** C08: never infer that a failed transport or missing terminal event
 * proves no side effect happened. Returning a Chat draft is not execution.
 */
export function reconcileUnconfirmedRunPrompt(requestId:string|null):string|null{
 if(!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))return null;
 return [
  "Inspect the existing LiOS Home execution history for the exact prior Chat run below. READ-ONLY reconciliation only.",
  `Prior request ID: ${requestId}.`,
  "Check whether Home received the run, its recorded checkpoint and any matching tool receipts, pending approvals, Project writes and external action outcome.",
  "A failed/interrupted Chat connection is not proof the run did not execute; missing receipts are not proof of success or failure.",
  "Do not replay this run, resume a checkpoint, repeat a tool, submit a write, create a workflow, notify anyone or infer an external side effect.",
  "If the server state cannot be verified, say outcome unknown and tell me how to inspect the exact recorded run manually.",
 ].join("\n");
}
