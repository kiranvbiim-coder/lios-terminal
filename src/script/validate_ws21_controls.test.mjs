import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../client/src/", import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), "utf8");
const sources = read("components/terminal/ChatSourcesControl.tsx");
const agent = read("components/terminal/BoundedAgentComposerControl.tsx");
const model = read("lib/useBoundedAgentComposer.ts");
const voice = read("lib/useVoiceInput.ts");
const shell = read("components/terminal/ProjectExperienceShell.tsx");
const policy = read("lib/composerAvailability.ts");
const registry = fs.readFileSync(new URL("../shared/sourceRegistry.ts", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server/voiceRoutes.ts", import.meta.url), "utf8");

test("WS-21 reuses original owner-scoped source registry and source-scope authority", () => {
  assert.match(sources, /queryKey: \["\/api\/setup\/source-registry"\]/);
  assert.match(sources, /apiRequest\("GET", "\/api\/setup\/source-registry"\)/);
  assert.match(sources, /P1_SOURCE_SCOPES.map/);
  assert.match(sources, /onScopeChange\(item.id\)/);
  assert.match(sources, /projectAvailable/);
  assert.match(sources, /Manage sources in Connection Center/);
  assert.doesNotMatch(sources, /localStorage|sessionStorage|credentials:/);
});

test("WS-21 connected does not equal operational and last observed status is explicit", () => {
  assert.match(registry, /operational: boolean/);
  assert.match(registry, /lastCheckedAt: string \| null/);
  assert.match(policy, /if \(!item.connected\) return "catalog_only"/);
  assert.match(policy, /if \(item.operational && item.lastCheckedAt\) return "operational"/);
  assert.match(sources, /sourceAvailability\(item\)/);
  assert.match(sources, /data-source-availability=\{availability\}/);
  assert.match(sources, /summary.operationalCount/);
  assert.match(sources, /time dateTime=\{item.lastCheckedAt\}/);
});

test("WS-21 registry failures do not claim current availability or hide the Retry", () => {
  assert.match(sources, /registry.isError && <p role="alert"/);
  assert.match(sources, /cached entries do not prove current availability/i);
  assert.match(sources, /registry.refetch\(\)/);
  assert.match(sources, /Checking source availability/);
  assert.match(sources, /summary.connectionCount === 0/);
});

test("WS-21 source choice does not grant data rights or claim known cost and quota", () => {
  assert.match(sources, /Connection state is not permission to send data to AI/);
  assert.match(sources, /review terms before using a paid source/);
  assert.match(sources, /Choosing a scope does not grant access or start retrieval/);
  assert.match(sources, /Licence restriction/);
  assert.doesNotMatch(sources, /Free trial|Unlimited queries|No cost|Provider cost: \$0/);
});

test("WS-21 Master AI, model, provider readiness come from same server endpoints", () => {
  assert.match(model, /"\/api\/wave-c\/ai\/state"/);
  assert.match(model, /"\/api\/setup\/status"/);
  assert.match(model, /provider\?\.available === true/);
  assert.match(model, /state.data\?\.state === "on"/);
  assert.match(model, /configuredProvider: ready \? provider\?\.id/);
  assert.match(model, /configuredModel: ready \? setup.data\?\.setup\?\.aiModelId/);
  assert.match(agent, /Provider cost, quotas and data-transfer terms are not verified here/);
  assert.match(agent, /onConfigureAI/);
});

test("WS-21 only registered voice provider and actual runtime readiness may enable microphone", () => {
  assert.match(server, /app.get\("\/api\/voice\/providers", requireAuth/);
  assert.match(voice, /queryKey: \["\/api\/voice\/providers"\]/);
  assert.match(policy, /input.browserRecordingReady === true/);
  assert.match(policy, /if \(input.error \|\| !input.transcription \|\| !input.speech\)/);
  assert.match(shell, /const voiceStatus = voiceAvailability/);
  assert.match(shell, /const voiceInputAvailable = voiceStatus.transcriptionReady/);
  assert.match(shell, /const voiceOutputAvailable = voiceStatus.speechReady/);
  assert.match(shell, /voiceProvidersQuery.refetch\(\)/);
});

test("WS-21 raw browser/provider errors are not passed into Chat or status", () => {
  assert.match(voice, /if \(!res.ok\) throw new Error\(voiceFailureCopy\(res.status\)\)/);
  assert.match(voice, /voiceTranscriptSchema.safeParse/);
  assert.match(voice, /setError\(voiceFailureCopy\("microphone"\)\)/);
  assert.doesNotMatch(voice, /payload\?\.error \|\|/);
  assert.doesNotMatch(voice, /permissionError\.message/);
  assert.match(policy, /Voice service unavailable/);
  assert.match(policy, /Voice transcription is not permitted/);
});

test("WS-21 voice only uploads on intentional Stop, then stages a reviewed transcript rather than sending automatically", () => {
  assert.match(voice, /recorder.onstop = async \(\) =>/);
  assert.match(voice, /fetch\("\/api\/voice\/transcribe", \{ method: "POST", body: form \}\)/);
  assert.match(voice, /onTranscript\(transcript\)/);
  assert.match(shell, /Audio is uploaded to LiOS Home only after recording stops/);
  assert.match(shell, /Review\/edit the transcript before Send/);
  assert.match(shell, /aria-describedby="lios-voice-consent"/);
  assert.match(shell, /voiceRecorder.isRecording/);
  assert.match(shell, /voiceTranscriptReviewed/);
});

test("WS-21 controls expose keyboard focus and never promise native acceptance", () => {
  assert.match(sources, /min-h-10/);
  assert.match(agent, /focus-visible:outline/);
  assert.match(shell, /Retry voice provider status/);
  const doc = fs.readFileSync(new URL("../../docs/ux/LIOS_WS21_SOURCE_MODEL_VOICE_CONTROLS_2026-10-23.md", import.meta.url), "utf8");
  for (const owner of ["#100", "#105", "#139", "#141"]) assert.ok(doc.includes(owner));
  assert.match(doc, /200% zoom[\s\S]{0,95}NOT_RUN/);
  assert.match(doc, /VoiceOver\/Narrator[\s\S]{0,95}NOT_RUN/);
});
