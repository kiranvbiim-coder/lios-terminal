import { z } from "zod";
import { callPythonService } from "./pythonService";

/** The original engine registry/request model owns input names; never infer them from caller JSON. */
export async function requirePythonInputFields(route: string, fields: readonly string[], signal?: AbortSignal): Promise<void> {
  if (!fields.length) return;
  const contract = z.object({ route: z.string(), fields: z.array(z.string()).max(500), required: z.array(z.string()).max(500) })
    .parse(await callPythonService("/input-contract", { route }, { signal, timeoutMs: 15_000 }));
  if (contract.route !== route || fields.some(field => !contract.fields.includes(field))) throw new Error("Source binding names a field outside the selected engine's canonical input contract.");
}
