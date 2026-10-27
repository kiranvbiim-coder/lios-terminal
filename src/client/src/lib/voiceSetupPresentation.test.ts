import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { checkedVoiceSetup, voiceReadVerified, voiceSetupStatus } from "./voiceSetupPresentation";

test("voice availability is never reported ready from failed cached or absent setup", () => {
  const prior = { recordingReady: true, transcriptionProviderReady: true };
  assert.equal(checkedVoiceSetup(prior, true), undefined);
  assert.equal(voiceSetupStatus({ loading: false, failed: true, hasData: true, ...prior }), "UNAVAILABLE");
  assert.equal(voiceSetupStatus({ loading: false, failed: false, hasData: false }), "UNAVAILABLE");
  assert.equal(voiceSetupStatus({ loading: true, failed: false, hasData: false }), "CHECKING");
});

test("voice readiness is a graduated observed state, not a file-selection claim", () => {
  assert.equal(voiceSetupStatus({ loading: false, failed: false, hasData: true, recordingReady: false, transcriptionProviderReady: false }), "OPTIONAL SETUP");
  assert.equal(voiceSetupStatus({ loading: false, failed: false, hasData: true, recordingReady: false, transcriptionProviderReady: true }), "NEEDS FFMPEG");
  assert.equal(voiceSetupStatus({ loading: false, failed: false, hasData: true, recordingReady: true }), "READY");
  assert.equal(voiceReadVerified({ isError: false, data: { recordingReady: false } }), true);
  assert.equal(voiceReadVerified({ isError: true, data: { recordingReady: true } }), false);
  assert.equal(voiceReadVerified({ isError: false, data: undefined }), false);
  assert.equal(voiceReadVerified({ isError: false, data: null }), false);
});

test("voice file selection success is announced only after actual GET setup refetch success", () => {
  const source = readFileSync(new URL("../components/settings/LocalVoiceRuntimeSettings.tsx", import.meta.url), "utf8");
  assert.match(source, /await apiRequest\("POST", "\/api\/voice\/setup\/refresh"\)/);
  assert.match(source, /const \[readiness\] = await Promise\.all\(\[/);
  assert.match(source, /setupQuery\.refetch\(\)/);
  assert.match(source, /if \(!voiceReadVerified\(readiness\)\)/);
  assert.match(source, /Voice file selection may have been saved, but readiness could not be verified/);
  assert.match(source, /setNotice\("Voice file selection saved\. Readiness was checked/);
  assert.match(source, /configurationInFlight\.current = kind/);
  assert.match(source, /if \(configurationInFlight\.current\) return;/);
  assert.match(source, /configurationInFlight\.current = null/);
  assert.doesNotMatch(source, /configureError\.message/);
});

test("voice setup failure provides a distinct accessible read-only retry and honest unknown statuses", () => {
  const source = readFileSync(new URL("../components/settings/LocalVoiceRuntimeSettings.tsx", import.meta.url), "utf8");
  const retryStart = source.indexOf('{setupQuery.isError && <div role="alert"');
  assert.ok(retryStart > 0);
  const retry = source.slice(retryStart, source.indexOf("Speech output remains opt-in", retryStart));
  assert.match(retry, /onClick=\{\(\) => void setupQuery\.refetch\(\)\}/);
  assert.match(retry, /disabled=\{setupQuery\.isFetching\}/);
  assert.match(retry, /aria-busy=\{setupQuery\.isFetching\}/);
  assert.match(retry, /Retry readiness \(read-only\)/);
  assert.doesNotMatch(retry, /apiRequest\("POST"/);
  assert.match(source, /const setup = checkedVoiceSetup\(setupQuery\.data, setupQuery\.isError\)/);
  assert.match(source, /"Status unavailable"/);
  assert.match(source, /"not verified"/);
  assert.ok((source.match(/min-h-11/g) ?? []).length >= 2);
  assert.doesNotMatch(source, /text-\[(?:7|8)px\]/);
});
