import { runQuantTruthAudit } from "../server/quantTruthAudit";

const audit = runQuantTruthAudit();
console.log(JSON.stringify(audit, null, 2));
if (!audit.ok) process.exitCode = 1;
