import {useEffect,useState} from "react";
import {marketEvidenceUtcDay} from "@shared/marketEvidenceTimeMachine";

export interface RetainedAsOfCapture {
  id:string; entityKey:string; datasetKey:string;dataClass:string;
  contentHash:string; availableAt:string;
  payload:{symbol?:string;seriesId?:string};
}
export type RecordedAsOfState<T> = {
  status:"idle"|"loading"|"ready"|"missing"|"unavailable";
  snapshot:T|null;
  error:string|null;
};

/** Strict identity gate for the canonical server's read-only historical lookup.
 * Historical data dates are NOT sufficient to prove that this saved capture was
 * actually available by the requested UTC day.
 */
export function validateRecordedAsOfCapture<T extends RetainedAsOfCapture>(
  candidate:unknown,
  expected:{entityKey:string;datasetKey:string;dataClass:"market_series"|"economic_series";day:string},
): T | null {
  const day=marketEvidenceUtcDay(expected.day);
  if (!day || !candidate || typeof candidate!=="object") return null;
  const record=candidate as Partial<RetainedAsOfCapture>;
  if (record.entityKey!==expected.entityKey || record.datasetKey!==expected.datasetKey ||
    record.dataClass!==expected.dataClass || typeof record.id!=="string" ||
    !/^[0-9a-f-]{36}$/i.test(record.id) ||
    typeof record.contentHash!=="string" || !/^[a-f0-9]{64}$/.test(record.contentHash) ||
    typeof record.availableAt!=="string" || !Number.isFinite(Date.parse(record.availableAt)) ||
    Date.parse(record.availableAt)>Date.parse(day+"T23:59:59.999Z") ||
    !record.payload || typeof record.payload!=="object" ||
    (expected.dataClass==="market_series" ? record.payload.symbol : record.payload.seriesId)!==expected.entityKey) return null;
  return candidate as T;
}

/** Direct, abortable, same-origin read against the existing indexed as-of store.
 * This is not a second snapshot cache or a provider re-fetch. It includes
 * captures older than the UI's normal 25/100-record list page.
 */
export function useRecordedAsOfSnapshot<T extends RetainedAsOfCapture>(
  request:{url:string;entityKey:string;datasetKey:string;dataClass:"market_series"|"economic_series";day:string;revision?:string},
):RecordedAsOfState<T> {
  const [observed,setObserved]=useState<(RecordedAsOfState<T>&{key:string})|null>(null);
  const key=[request.url,request.entityKey,request.datasetKey,request.dataClass,request.day,request.revision ?? ""].join("\u0001");
  useEffect(()=>{
    if (!request.day) {setObserved(null);return;}
    if (!marketEvidenceUtcDay(request.day)) {
      setObserved({key,status:"unavailable",snapshot:null,error:"Invalid UTC calendar date."});
      return;
    }
    const controller=new AbortController();
    setObserved({key,status:"loading",snapshot:null,error:null});
    const asOf=request.day+"T23:59:59.999Z";
    void (async()=>{
      try {
        const separator=request.url.includes("?")?"&":"?";
        const response=await fetch(request.url+separator+"asOf="+encodeURIComponent(asOf),{
          credentials:"same-origin",cache:"no-store",signal:controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status===404) {
          setObserved({key,status:"missing",snapshot:null,error:null});
          return;
        }
        if (!response.ok) throw new Error("Authorized historical snapshot lookup unavailable.");
        const raw:unknown=await response.json();
        if (controller.signal.aborted) return;
        const snapshot=validateRecordedAsOfCapture<T>(raw,request);
        if (!snapshot) throw new Error("Historical snapshot identity or availability could not be verified.");
        setObserved({key,status:"ready",snapshot,error:null});
      } catch (cause) {
        if (!controller.signal.aborted) setObserved({key,status:"unavailable",snapshot:null,
          error:cause instanceof Error?cause.message:"Historical snapshot lookup unavailable."});
      }
    })();
    return()=>controller.abort();
  },[key]);
  if (!request.day) return {status:"idle",snapshot:null,error:null};
  return observed?.key===key ? observed : {status:"loading",snapshot:null,error:null};
}
