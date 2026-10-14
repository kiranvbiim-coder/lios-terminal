import type { ContractField, ContractFieldType } from "./dataContracts";
import { CONTRACT_FAMILIES } from "./dataContracts";

export const FIELD_DICTIONARY_VERSION = "1" as const;

export interface CanonicalFieldDescriptor extends ContractField {
  id: string;
  kind: "canonical";
  contractFamily: string;
}

export interface ExtendedFieldDescriptor {
  id: string;
  kind: "extended";
  contractFamily: null;
  providerId: string;
  providerField: string;
  name: string;
  type: ContractFieldType;
  requirement: "optional";
  description: string;
}

export type UniversalFieldDescriptor = CanonicalFieldDescriptor | ExtendedFieldDescriptor;

export interface UniversalFieldDictionary {
  version: typeof FIELD_DICTIONARY_VERSION;
  fields: CanonicalFieldDescriptor[];
  byId: ReadonlyMap<string, CanonicalFieldDescriptor>;
}

function normalizeIdentifierPart(value: string): string {
  return value.trim().replace(/\s+/g, "_");
}

export function buildUniversalFieldDictionary(): UniversalFieldDictionary {
  const fields: CanonicalFieldDescriptor[] = [];
  const byId = new Map<string, CanonicalFieldDescriptor>();

  for (const family of CONTRACT_FAMILIES) {
    for (const field of family.fields) {
      const id = `${family.id}.${field.name}`;
      if (byId.has(id)) {
        throw new Error(`Duplicate canonical data field id: ${id}`);
      }
      const descriptor: CanonicalFieldDescriptor = {
        ...field,
        id,
        kind: "canonical",
        contractFamily: family.id,
      };
      fields.push(descriptor);
      byId.set(id, descriptor);
    }
  }

  return { version: FIELD_DICTIONARY_VERSION, fields, byId };
}

let cachedDictionary: UniversalFieldDictionary | null = null;

export function getUniversalFieldDictionary(): UniversalFieldDictionary {
  cachedDictionary ??= buildUniversalFieldDictionary();
  return cachedDictionary;
}

export function getCanonicalField(fieldId: string): CanonicalFieldDescriptor | null {
  return getUniversalFieldDictionary().byId.get(fieldId) ?? null;
}

export function createExtendedFieldDescriptor(input: {
  providerId: string;
  providerField: string;
  inferredType?: ContractFieldType;
  description?: string;
}): ExtendedFieldDescriptor {
  const providerId = normalizeIdentifierPart(input.providerId);
  const providerField = input.providerField.trim();
  if (!providerId) throw new Error("providerId is required for an extended field");
  if (!providerField) throw new Error("providerField is required for an extended field");

  return {
    id: `${providerId}:${providerField}`,
    kind: "extended",
    contractFamily: null,
    providerId,
    providerField,
    name: providerField,
    type: input.inferredType ?? "string",
    requirement: "optional",
    description: input.description ?? `Provider-specific field from ${providerId}: ${providerField}`,
  };
}
