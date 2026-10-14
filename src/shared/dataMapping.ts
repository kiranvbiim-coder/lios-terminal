import { z } from "zod";
import type { ContractFieldType } from "./dataContracts";
import {
  FIELD_DICTIONARY_VERSION,
  createExtendedFieldDescriptor,
  getUniversalFieldDictionary,
  type UniversalFieldDescriptor,
} from "./dataFieldDictionary";

export const DATA_TRANSFORMS = [
  "identity",
  "percentage_to_decimal",
  "decimal_to_percentage",
  "thousands_to_units",
  "millions_to_units",
  "date_iso",
  "uppercase",
  "lowercase",
] as const;

export type DataTransform = (typeof DATA_TRANSFORMS)[number];
export type MappingTargetKind = "canonical" | "extended";

export interface MappingSuggestion {
  providerId: string;
  datasetKey: string;
  providerField: string;
  targetFieldId: string;
  targetKind: MappingTargetKind;
  transform: DataTransform;
  confidence: number;
  reasons: string[];
  source: "deterministic" | "ai";
  executable: false;
  ai?: {
    model?: string;
    rationale?: string;
  };
}

export interface DiscoveredProviderField {
  providerField: string;
  inferredType?: ContractFieldType;
  descriptor: UniversalFieldDescriptor;
  suggestion: MappingSuggestion;
}

export interface ProviderSchemaDiscoveryResult {
  providerId: string;
  datasetKey: string;
  contractFamily: string | null;
  dictionaryVersion: typeof FIELD_DICTIONARY_VERSION;
  fields: DiscoveredProviderField[];
}

export const confirmedMappingInputSchema = z.object({
  organizationId: z.number().int().positive().nullable(),
  ownerUserId: z.number().int().positive(),
  providerId: z.string().trim().min(1).max(120),
  datasetKey: z.string().trim().min(1).max(240),
  providerField: z.string().trim().min(1).max(512),
  targetFieldId: z.string().trim().min(1).max(768),
  targetKind: z.enum(["canonical", "extended"]),
  transform: z.enum(DATA_TRANSFORMS).default("identity"),
});

export type ConfirmedMappingInput = z.infer<typeof confirmedMappingInputSchema>;

function normalizedFieldName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function typeCompatibilityScore(providerType: ContractFieldType | undefined, target: UniversalFieldDescriptor): number {
  if (!providerType) return 0;
  if (providerType === target.type) return 0.08;
  const numeric = new Set<ContractFieldType>(["number", "integer", "currency_amount", "percentage", "ratio"]);
  return numeric.has(providerType) && numeric.has(target.type) ? 0.03 : -0.08;
}

export function suggestDataMapping(input: {
  providerId: string;
  datasetKey: string;
  contractFamily?: string | null;
  providerField: string;
  inferredType?: ContractFieldType;
  aiSuggestion?: { targetFieldId: string; confidence: number; model?: string; rationale?: string } | null;
}): MappingSuggestion {
  const dictionary = getUniversalFieldDictionary();
  const providerNormalized = normalizedFieldName(input.providerField);
  const candidates = dictionary.fields.filter((field) => !input.contractFamily || field.contractFamily === input.contractFamily);

  let best: { field: UniversalFieldDescriptor; score: number; reasons: string[] } | null = null;
  for (const field of candidates) {
    const canonicalName = normalizedFieldName(field.name);
    const description = normalizedFieldName(field.description);
    let score = 0;
    const reasons: string[] = [];

    if (canonicalName === providerNormalized) {
      score = 0.92;
      reasons.push("normalized field name matches canonical field");
    } else if (description === providerNormalized || description.includes(providerNormalized)) {
      score = 0.72;
      reasons.push("provider field text overlaps canonical description/name");
    }
    if (score > 0) {
      score = Math.max(0, Math.min(1, score + typeCompatibilityScore(input.inferredType, field)));
      if (!best || score > best.score) best = { field, score, reasons };
    }
  }

  if (best && best.score >= 0.65) {
    return {
      providerId: input.providerId,
      datasetKey: input.datasetKey,
      providerField: input.providerField,
      targetFieldId: best.field.id,
      targetKind: "canonical",
      transform: "identity",
      confidence: best.score,
      reasons: best.reasons,
      source: "deterministic",
      executable: false,
    };
  }

  if (input.aiSuggestion) {
    const canonical = dictionary.byId.get(input.aiSuggestion.targetFieldId);
    if (canonical) {
      return {
        providerId: input.providerId,
        datasetKey: input.datasetKey,
        providerField: input.providerField,
        targetFieldId: canonical.id,
        targetKind: "canonical",
        transform: "identity",
        confidence: Math.max(0, Math.min(1, input.aiSuggestion.confidence)),
        reasons: ["optional AI mapping suggestion; user confirmation required"],
        source: "ai",
        executable: false,
        ai: { model: input.aiSuggestion.model, rationale: input.aiSuggestion.rationale },
      };
    }
  }

  const extended = createExtendedFieldDescriptor({
    providerId: input.providerId,
    providerField: input.providerField,
    inferredType: input.inferredType,
  });
  return {
    providerId: input.providerId,
    datasetKey: input.datasetKey,
    providerField: input.providerField,
    targetFieldId: extended.id,
    targetKind: "extended",
    transform: "identity",
    confidence: 1,
    reasons: ["no sufficiently strong canonical match; preserve provider field as extended"],
    source: "deterministic",
    executable: false,
  };
}

export function discoverProviderSchema(input: {
  providerId: string;
  datasetKey: string;
  contractFamily?: string | null;
  fields: Array<{ providerField: string; inferredType?: ContractFieldType }>;
}): ProviderSchemaDiscoveryResult {
  const dictionary = getUniversalFieldDictionary();
  const seen = new Set<string>();
  const fields = input.fields.map((field): DiscoveredProviderField => {
    const providerField = field.providerField.trim();
    if (!providerField) throw new Error("providerField is required during schema discovery");
    if (seen.has(providerField)) throw new Error(`Duplicate provider field during schema discovery: ${providerField}`);
    seen.add(providerField);

    const suggestion = suggestDataMapping({
      providerId: input.providerId,
      datasetKey: input.datasetKey,
      contractFamily: input.contractFamily,
      providerField,
      inferredType: field.inferredType,
    });
    const descriptor = suggestion.targetKind === "canonical"
      ? dictionary.byId.get(suggestion.targetFieldId)
      : createExtendedFieldDescriptor({
          providerId: input.providerId,
          providerField,
          inferredType: field.inferredType,
        });
    if (!descriptor) throw new Error(`Suggested canonical field is not registered: ${suggestion.targetFieldId}`);
    return { providerField, inferredType: field.inferredType, descriptor, suggestion };
  });

  return {
    providerId: input.providerId,
    datasetKey: input.datasetKey,
    contractFamily: input.contractFamily ?? null,
    dictionaryVersion: FIELD_DICTIONARY_VERSION,
    fields,
  };
}

export function validateConfirmedMappingTarget(input: ConfirmedMappingInput): ConfirmedMappingInput {
  const parsed = confirmedMappingInputSchema.parse(input);
  if (parsed.targetKind === "canonical") {
    if (!getUniversalFieldDictionary().byId.has(parsed.targetFieldId)) {
      throw new Error(`Unknown canonical target field: ${parsed.targetFieldId}`);
    }
  } else {
    const expectedPrefix = `${parsed.providerId}:`;
    if (!parsed.targetFieldId.startsWith(expectedPrefix)) {
      throw new Error(`Extended target must be namespaced to provider ${parsed.providerId}`);
    }
  }
  return parsed;
}
