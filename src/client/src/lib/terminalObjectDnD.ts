import type { IntelligenceObject } from "./terminalIntelligenceObjects";

export const INTELLIGENCE_OBJECT_MIME = "application/x-lios-intelligence-object";

export interface IntelligenceObjectDragPayload {
  objectId: string;
  kind: IntelligenceObject["kind"];
  label: string;
  symbol?: string;
}

export function intelligenceObjectDragPayload(object: IntelligenceObject): IntelligenceObjectDragPayload {
  return { objectId: object.id, kind: object.kind, label: object.label, symbol: object.symbol };
}

export function writeIntelligenceObjectDrag(dataTransfer: DataTransfer, object: IntelligenceObject): void {
  const payload = intelligenceObjectDragPayload(object);
  dataTransfer.effectAllowed = "copyMove";
  dataTransfer.setData(INTELLIGENCE_OBJECT_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", `${object.kind.toUpperCase()} · ${object.label}${object.symbol ? ` · ${object.symbol}` : ""}`);
}

export function readIntelligenceObjectDrag(dataTransfer: DataTransfer): IntelligenceObjectDragPayload | null {
  const raw = dataTransfer.getData(INTELLIGENCE_OBJECT_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<IntelligenceObjectDragPayload>;
    if (!parsed.objectId || !parsed.kind || !parsed.label) return null;
    return { objectId: parsed.objectId, kind: parsed.kind as IntelligenceObject["kind"], label: parsed.label, symbol: parsed.symbol };
  } catch { return null; }
}
