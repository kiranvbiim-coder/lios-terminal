import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readQualificationWorkflow } from "./source_distribution";
import { createRuntimeFoundationRegistry } from "../server/runtimeFoundation";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.resolve(root, file), "utf8");

const roadmap = read("../docs/LIOS_EXECUTION_ROADMAP.md");
const architecture = read("../docs/LIOS_ARCHITECTURE.md");
const contracts = read("shared/multimodalContracts.ts");
const conversationContracts = read("shared/conversationRuntime.ts");
const voice = read("server/p12VoiceRuntime.ts");
const voicePack = read("server/p12VoicePack.ts");
const voiceClient = read("client/src/lib/useVoiceInput.ts");
const voiceTests = read("server/p12VoiceRuntime.test.ts");
const voiceSetup = read("server/voiceProviderSetup.ts");
const voiceRoutes = read("server/voiceRoutes.ts");
const app = read("client/src/App.tsx");
const connectionCenter = read("client/src/pages/DataConnectionCenter.tsx");
const desktopMain = read("main.cjs");
const desktopPreload = read("preload.cjs");
const multimodal = read("server/p12Multimodal.ts");
const upload = read("server/uploadPolicy.ts");
const projectComposer = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const projectRoutes = read("server/projectRoutes.ts");
const projectConversationRoutes = read("server/conversationRunService.ts");
const conversationRuntime = read("server/conversationRuntime.ts");
const projectStore = read("server/projectStore.ts");
const projectResourceStore = read("server/projectResourceStore.ts");
const projectAttachmentService = read("server/projectAttachmentService.ts");
// GM-05: the private-storage behaviour moved from the attachment store into the StorageProvider fabric.
const projectAttachmentStore = ["server/projectAttachmentStore.ts", "server/storageRuntime.ts", "server/storageProvider.ts"].map(read).join("\n");
const projectAttachmentContent = read("server/projectAttachmentContent.ts");
const projectAttachmentServiceTests = read("server/projectAttachmentService.test.ts");
const projectAttachmentRestartTests = read("server/projectAttachmentRestart.test.ts");
const projectAttachmentContentTests = read("server/projectAttachmentContent.test.ts");
const terminalUxStabilization = read("client/src/terminal-ux-stabilization.css");
const clientMain = read("client/src/main.tsx");
const byoaiTransport = read("server/byoaiTransport.ts");
const byoaiTransportTests = read("server/byoaiTransport.test.ts");
const foundation = read("server/runtimeFoundation.ts");
const benchmark = read("script/benchmark_p12_whisper_cpp.ts");
const qualityGate = readQualificationWorkflow(path.resolve(root, ".."), "lios-hardening.yml");
const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
const projectChatTests = fs.readdirSync(path.resolve(root, "server"))
  .filter((file) => /project.*(?:test|spec)\.(?:ts|tsx)$/.test(file))
  .map((file) => fs.readFileSync(path.resolve(root, "server", file), "utf8"))
  .join("\n");

const localVoiceSettingsMounted = app.includes("DataConnectionCenter")
  && /<LocalVoiceRuntimeSettings\b/.test(connectionCenter);
const highImpactTranscriptReviewGuardConnected = voice.includes("assertVoiceTranscriptReviewed")
  && projectComposer.includes("voiceReview")
  && projectComposer.includes("voiceTranscriptReviewed")
  && projectComposer.includes("status === 428")
  && projectConversationRoutes.includes("voiceExecutionReviewSchema")
  && projectConversationRoutes.includes("prepareVoiceConversationRequest")
  && projectConversationRoutes.includes("assertVoiceTranscriptReviewed")
  && projectConversationRoutes.includes("transcriptReviewed")
  && projectChatTests.includes("unreviewedProjectVoice")
  && projectChatTests.includes("unreviewedTemporaryVoice")
  && projectChatTests.includes("transcript review must not bypass normal action approval");

const evidence: Record<string, boolean> = {
  "LIOS-P12-01":
    voice.includes("prepareVoiceConversationRequest")
    && voice.includes("cloneConversationRequestWithTranscript")
    && voiceTests.includes("same canonical ConversationRequest/context"),
  "LIOS-P12-02":
    voice.includes("createWhisperCppProvider")
    && voice.includes("benchmarkWhisperCpp")
    && contracts.includes("P12_WHISPER_CPP_BUDGET")
    && benchmark.includes("WHISPER_CPP_BIN")
    && benchmark.includes("process.exitCode = 1")
    && voiceSetup.includes("inspectVoiceRuntimeSetup")
    && voiceSetup.includes("refreshVoiceProviders"),
  "LIOS-P12-03":
    voice.includes("transcriptReviewRequired")
    && voice.includes("assertVoiceTranscriptReviewed")
    && voiceTests.includes("high-impact spoken command requires transcript review"),
  "LIOS-P12-04":
    voice.includes("registerSpeechOutputProvider")
    && voice.includes("synthesizeSpeechOutput")
    && contracts.includes("speechOutputPreferenceSchema")
    && voiceTests.includes("speech output is opt-in"),
  "LIOS-P12-05":
    voiceTests.includes("typed and spoken versions produce equivalent governed plans and context")
    && voiceTests.includes("transmissionPolicy")
    && voiceTests.includes("approvals"),
  "LIOS-P12-06":
    conversationContracts.includes("conversationAttachmentRefSchema")
    && multimodal.includes("attachMultimodalInputs")
    && multimodal.includes("document_intelligence")
    && upload.includes('ext === "png"')
    && upload.includes('ext === "jpg"')
    && upload.includes('ext === "webp"'),
};

for (let id = 1; id <= 6; id += 1) {
  const taskId = "LIOS-P12-" + String(id).padStart(2, "0");
  const rows = roadmap.split("\n").filter((line) => line.startsWith("| " + taskId + " |")).length;
  assert.equal(rows, 1, "Roadmap must contain exactly one canonical row for " + taskId + ".");
  assert.equal(evidence[taskId], true, "P12 acceptance evidence missing for " + taskId + ".");
}

const registry = createRuntimeFoundationRegistry();
assert.ok(registry.list().some((component) => component.id === "p12:voice-input"), "P12 voice input adapter missing from canonical RuntimeRegistry.");
assert.ok(registry.list().some((component) => component.id === "p12:speech-output"), "P12 speech output adapter missing from canonical RuntimeRegistry.");
assert.ok(foundation.includes("createP12RuntimeAdapters"), "P12 adapters are not wired into the canonical runtime foundation.");
assert.ok(packageJson.scripts?.["test:p12"], "P12 test script missing.");
assert.ok(packageJson.scripts?.["acceptance:p12"], "P12 acceptance script missing.");
assert.ok(packageJson.scripts?.["benchmark:p12:whisper"], "P12 whisper.cpp benchmark script missing.");
assert.ok(qualityGate.includes("P12 Voice and multimodal acceptance"), "P12 is missing from the normal quality gate.");
assert.ok(architecture.includes("audio → permitted transcription provider/local pack → transcript → normal context/intent/tool runtime"), "Canonical P12 voice architecture is missing.");
assert.ok(!roadmap.includes("### P12 — Plugin"), "P12 phase identity drifted away from Voice and multimodal.");
assert.ok(voiceRoutes.includes('"/api/voice/setup"') && voiceRoutes.includes('"/api/voice/setup/refresh"'), "P12 voice runtime readiness/refresh routes are missing.");
assert.ok(desktopMain.includes('"limuria:voice-runtime-configure"') && desktopPreload.includes("configureVoiceRuntimeFile"), "P12 desktop-native voice runtime picker is missing.");
assert.ok(/<DataConnectionCenter\b/.test(app), "P12 mounted-surface acceptance must follow the Connection Center rendered by the active app.");
assert.ok(voiceSetup.includes("voice-runtime.json") && !voiceSetup.includes("https://"), "P12 local voice setup must store local paths only and must not silently download a runtime.");
assert.ok(!voiceSetup.includes('resolveBinary(process.platform === "win32" ? "main.exe" : "main")'), "P12 must not auto-execute an ambiguous PATH binary named main.");
assert.ok(voicePack.includes("runtime-packs/lios.voice/current")
  && voicePack.includes("where.exe")
  && voicePack.includes("user_or_release_provisioned_no_silent_download")
  && voicePack.includes("explicitPaths"),
  "P12 managed Voice Pack discovery must be cross-platform, explicit-path aware, and non-downloading.");
assert.ok(voiceRoutes.includes("inspectVoiceRuntimePublicStatus"),
  "P12 provider route must expose privacy-safe managed voice readiness.");
assert.ok(voiceClient.includes("browserRecordingReady") && voiceClient.includes("guidance"),
  "P12 client must receive actionable browser-recording readiness.");
assert.ok(packageJson.scripts?.["test:p12"]?.includes("p12VoicePack.test.ts"),
  "P12 managed Voice Pack tests are missing from the phase suite.");

const attachmentPipeline = {
  contractsAndNormalizationHelpers: conversationContracts.includes("conversationAttachmentRefSchema")
    && multimodal.includes("attachMultimodalInputs")
    ? "PRESENT"
    : "MISSING",
  projectChatUploadControl: projectComposer.includes("attachmentInputRef")
    && projectComposer.includes("stageAttachmentFiles")
    && projectComposer.includes("uploadProjectChatAttachment")
    && !/attachments:\s*\[\s*\]/.test(projectComposer)
    ? "PRESENT"
    : "NOT PRESENT",
  projectChatUploadRoute: projectRoutes.includes("/api/projects/:projectId/chats/:chatId/attachments")
    && projectRoutes.includes('single("file")')
    && projectAttachmentService.includes("uploadProjectChatAttachment")
    ? "PRESENT"
    : "NOT PRESENT",
  authenticatedProjectChatUploadRoute: projectRoutes.includes("/api/projects/:projectId/chats/:chatId/attachments")
    && projectRoutes.includes("app.use(prefix, requireAuth)")
    ? "PRESENT"
    : "NOT PRESENT",
  persistedDownloadRoute: projectRoutes.includes("/api/projects/:projectId/attachments/:attachmentId/download")
    && projectRoutes.includes("loadProjectAttachment")
    ? "PRESENT"
    : "NOT PRESENT",
  conversationRuntimeConsumption: projectConversationRoutes.includes("resolveProjectConversationAttachments")
    && projectConversationRoutes.includes("request: runtimeRequest")
    && conversationRuntime.includes("resolvedAttachments")
    && conversationRuntime.includes("aiAttachmentUserMessage")
    && projectAttachmentContent.includes("formatAttachmentTextContext")
    && projectAttachmentService.includes("textTruncation = resolved.textTruncation")
    ? "PRESENT"
    : "NOT WIRED",
  projectChatPersistence: projectConversationRoutes.includes("attachments: runtimeRequest.attachments.map")
    && projectComposer.includes("savedMessageAttachments")
    && projectAttachmentService.includes("createProjectResource")
    ? "PRESENT"
    : "NOT VERIFIED",
  localPrivateStorage: projectAttachmentStore.includes("LIOS_ATTACHMENT_STORAGE_DIR")
    && projectAttachmentStore.includes("0o700")
    && projectAttachmentStore.includes("0o600")
    && projectAttachmentStore.includes("DATABASE_URL")
    ? "PRESENT"
    : "NOT VERIFIED",
  transmissionAndVisionPolicy: projectAttachmentService.includes("includeContents")
    && projectConversationRoutes.includes("request.transmissionPolicy.allowResourceReferences")
    && byoaiTransport.includes("supportsImageInput")
    && byoaiTransport.includes("Do not silently transmit private images")
    && byoaiTransportTests.includes("provider-specific request formats")
    ? "PRESENT"
    : "NOT VERIFIED",
  contentAndLifecycleTests: projectAttachmentServiceTests.includes("Project attachments are Project/chat scoped")
    && projectAttachmentContentTests.includes("integrity checks")
    && projectChatTests.includes("Project attachment HTTP routes enforce auth")
    && projectResourceStore.includes("deleteProjectAttachmentResourceBlob")
    && projectStore.includes("deleteProjectAttachmentResourceBlob")
    ? "PRESENT"
    : "NOT VERIFIED",
  restartPersistenceAndRecovery: projectAttachmentRestartTests.includes("survive restart")
    && projectAttachmentRestartTests.includes("await closeDb();")
    && projectAttachmentRestartTests.includes("await initDb();")
    && projectAttachmentRestartTests.includes("saved chat message must retain governed attachment references across restart")
    && projectAttachmentRestartTests.includes("corrupted persisted blobs must fail integrity checks")
    && projectAttachmentRestartTests.includes("failed storage writes must not leave orphaned Project Resource metadata")
    ? "PRESENT"
    : "NOT VERIFIED",
  projectChatEndToEndTest: projectChatTests.includes("Project attachment HTTP routes enforce auth")
    ? "PRESENT"
    : "NOT PRESENT",
};
const voiceIntegration = {
  localVoiceSettingsMounted: localVoiceSettingsMounted ? "PRESENT" : "NOT PRESENT",
  activeComposerKeepsTranscriptEditable: projectComposer.includes("useVoiceRecorder")
    && /setInput\(\(current\).*result\.text/.test(projectComposer)
    && projectComposer.includes("value={input}")
    ? "PRESENT"
    : "NOT VERIFIED",
  highImpactTranscriptReviewGuardConnected: highImpactTranscriptReviewGuardConnected ? "PRESENT" : "NOT CONNECTED",
};
const voiceIntegrationBlockers = [
  voiceIntegration.localVoiceSettingsMounted === "NOT PRESENT"
    ? "The mounted Connection Center does not expose Local Voice Runtime setup; the legacy Environment Setup screen is not the active route."
    : null,
  voiceIntegration.highImpactTranscriptReviewGuardConnected === "NOT CONNECTED"
    ? "The voice transcript-review requirement is not carried into and enforced by the authenticated Project-chat execution route."
    : null,
].filter((item): item is string => Boolean(item));
const attachmentBlockers = [
  attachmentPipeline.projectChatUploadControl === "NOT PRESENT"
    ? "Project chat has no user-facing file picker/drop flow and submits attachments: []."
    : null,
  attachmentPipeline.projectChatUploadRoute === "NOT PRESENT"
    ? "No production Project/conversation attachment upload route is registered."
    : null,
  attachmentPipeline.authenticatedProjectChatUploadRoute === "NOT PRESENT"
    ? "No authenticated Project-chat attachment upload route is registered."
    : null,
  attachmentPipeline.conversationRuntimeConsumption === "NOT WIRED"
    ? "Conversation Runtime does not consume attachment references from the request."
    : null,
  attachmentPipeline.projectChatPersistence === "NOT VERIFIED"
    ? "Project chat persistence has no attachment state to reopen after restart."
    : null,
  attachmentPipeline.persistedDownloadRoute === "NOT PRESENT"
    ? "Saved Project attachment downloads are not wired through Project ownership checks."
    : null,
  attachmentPipeline.localPrivateStorage === "NOT VERIFIED"
    ? "Private local or explicitly persistent attachment storage is not proven."
    : null,
  attachmentPipeline.transmissionAndVisionPolicy === "NOT VERIFIED"
    ? "Attachment transmission policy or verified image-provider handling is not proven."
    : null,
  attachmentPipeline.contentAndLifecycleTests === "NOT VERIFIED"
    ? "Attachment content integrity, tenant isolation or blob lifecycle has no focused test evidence."
    : null,
  attachmentPipeline.projectChatEndToEndTest === "NOT PRESENT"
    ? "No Project-chat attachment end-to-end HTTP test proves upload, authorization, runtime and persistence behavior."
    : null,
  attachmentPipeline.restartPersistenceAndRecovery === "NOT VERIFIED"
    ? "Attachment resources/messages/blobs do not have restart persistence and storage-failure recovery evidence."
    : null,
].filter((item): item is string => Boolean(item));
const productBlockers = [...voiceIntegrationBlockers, ...attachmentBlockers];
assert.equal(productBlockers.length, 0, "P12 source acceptance still has unresolved integration blockers: " + productBlockers.join(" | "));
assert.ok(packageJson.scripts?.["test:p12"]?.includes("projectAttachmentRestart.test.ts"),
  "P12 restart/recovery proof is missing from the phase suite.");

console.log(JSON.stringify({
  phase: "P12 Voice and multimodal",
  foundationContracts: "PASS",
  sourceAcceptance: "PASS",
  productAcceptance: "OPEN_FOR_INTERACTIVE_AND_PACKAGED_QA",
  voiceIntegration,
  attachmentPipeline,
  blockers: productBlockers,
  attachmentInteractiveAndPackagedQA: "REQUIRED_NOT_RECORDED",
  liveAiAcceptance: "REQUIRES_USER_CONFIGURED_PROVIDER; MOCK_TRANSPORT_TESTS_ARE_NOT_LIVE_ACCEPTANCE",
  voiceRuntimeWalkthrough: "REQUIRED_NOT_RECORDED",
}, null, 2));


assert.ok(
  terminalUxStabilization.includes("P1-17 continued") && !clientMain.includes("project-experience-ux.css"),
  "P1-17 Project-shell polish must stay consolidated in the existing stabilization stylesheet.",
);
