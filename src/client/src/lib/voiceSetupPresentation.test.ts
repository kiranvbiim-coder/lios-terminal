import assert from "node:assert/strict";
import test from "node:test";
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

