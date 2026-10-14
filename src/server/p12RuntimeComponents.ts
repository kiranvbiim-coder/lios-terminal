import {
  LIOS_RUNTIME_CONTRACT_VERSION,
  runtimeComponentDescriptorSchema,
  type RuntimeAdapter,
} from "@shared/runtimeContracts";

export function createP12RuntimeAdapters(): RuntimeAdapter[] {
  return [
    {
      descriptor: runtimeComponentDescriptorSchema.parse({
        contractVersion: LIOS_RUNTIME_CONTRACT_VERSION,
        id: "p12:voice-input",
        kind: "tool",
        name: "Voice Input",
        version: "1.0.0",
        lifecycle: "optional",
        executionScopes: ["node_worker", "external_process"],
        capabilities: ["conversation:voice-input", "transcription:provider"],
        permissions: ["microphone:local"],
        runtimePackId: "lios.voice",
        replaceable: true,
        source: { origin: "lios", importedPaths: [], modified: false },
      }),
    },
    {
      descriptor: runtimeComponentDescriptorSchema.parse({
        contractVersion: LIOS_RUNTIME_CONTRACT_VERSION,
        id: "p12:speech-output",
        kind: "tool",
        name: "Speech Output",
        version: "1.0.0",
        lifecycle: "optional",
        executionScopes: ["node_worker", "local_api", "remote_api"],
        capabilities: ["conversation:speech-output"],
        permissions: [],
        runtimePackId: "lios.voice",
        replaceable: true,
        source: { origin: "lios", importedPaths: [], modified: false },
      }),
    },
  ];
}
