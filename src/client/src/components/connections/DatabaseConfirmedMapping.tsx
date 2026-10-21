import * as React from "react";
import { useMemo, useState } from "react";
import { DATA_TRANSFORMS, type DataTransform } from "@shared/dataMapping";
import { getUniversalFieldDictionary } from "@shared/dataFieldDictionary";
import { apiRequest } from "@/lib/queryClient";

export default function DatabaseConfirmedMapping({ connectionId, datasetKey, columns }: { connectionId: number; datasetKey: string; columns: string[] }) {
  const [field, setField] = useState(columns[0] ?? "");
  const [target, setTarget] = useState("");
  const [transform, setTransform] = useState<DataTransform>("identity");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const dictionary = useMemo(() => getUniversalFieldDictionary().fields, []);
  const confirm = async () => {
    if (pending || !field || !target) return;
    setPending(true); setFailure(null); setMessage(null);
    try {
      const response = await apiRequest("POST", "/api/data-fabric/mappings/confirm", { providerId: `source-connection:${connectionId}`, datasetKey, providerField: field, targetFieldId: target, targetKind: "canonical", transform });
      const saved = await response.json();
      setMessage(`Confirmed mapping revision ${saved.version}: ${field} → ${target}. Query this dataset with its exact key to apply confirmed mappings. Discovery alone never runs this mapping.`);
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : "Mapping confirmation failed."); }
    finally { setPending(false); }
  };
  return <section aria-label="Confirm database field mapping" className="mt-4 space-y-3 rounded border border-border p-3 text-sm">
    <h3 className="font-medium">Confirm semantic mapping</h3>
    <p className="text-xs text-muted-foreground">Dataset: {datasetKey}. Choose the exact source column, canonical field and unit transform. This saves a versioned mapping in the existing data catalogue; it does not modify your database or grant AI transmission or export rights.</p>
    <label className="block">Source column<select aria-label="Mapping source column" value={field} disabled={pending} onChange={event => setField(event.target.value)} className="ml-2 max-w-full border border-border bg-background p-2">{columns.map(column => <option key={column} value={column}>{column}</option>)}</select></label>
    <label className="block">Canonical field<select aria-label="Mapping canonical field" value={target} disabled={pending} onChange={event => setTarget(event.target.value)} className="ml-2 max-w-full border border-border bg-background p-2"><option value="">Choose explicitly…</option>{dictionary.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label>
    <label className="block">Transform<select aria-label="Mapping transform" value={transform} disabled={pending} onChange={event => setTransform(event.target.value as DataTransform)} className="ml-2 border border-border bg-background p-2">{DATA_TRANSFORMS.map(item => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
    <button type="button" disabled={pending || !field || !target} onClick={() => void confirm()} className="rounded border border-border px-3 py-2 disabled:opacity-40">{pending ? "Confirming…" : "Confirm this exact mapping"}</button>
    {message && <p role="status">{message}</p>}{failure && <p role="alert">{failure}</p>}
  </section>;
}
