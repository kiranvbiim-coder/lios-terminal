import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_ARTIFACT_WIDTH, MIN_CONVERSATION_WIDTH, clampConversationSidecarWidth,
} from "./conversationSidecarSizing";

test("WS-59 sidecar sizing retains at least 360px Chat on split-capable widths", () => {
  for (const width of [1024, 1280, 1440, 2560]) {
    const resized = clampConversationSidecarWidth(2000, width);
    assert.ok(resized >= MIN_ARTIFACT_WIDTH);
    assert.ok(resized <= width * 0.8);
    assert.ok(width - resized >= MIN_CONVERSATION_WIDTH);
  }
});

test("WS-59 narrow 320/375/390/768 widths cannot produce negative or runaway sizing", () => {
  for (const width of [320, 375, 390, 768]) {
    for (const requested of [-9000, 0, 320, 1800, Number.POSITIVE_INFINITY, NaN]) {
      const result = clampConversationSidecarWidth(requested, width);
      assert.ok(Number.isFinite(result));
      assert.ok(result >= MIN_ARTIFACT_WIDTH);
      assert.ok(result <= Math.max(MIN_ARTIFACT_WIDTH, width * 0.8));
    }
  }
});

test("WS-59 keyboard resizing steps clamp in both directions", () => {
  assert.equal(clampConversationSidecarWidth(500, 800), 440);
  assert.equal(clampConversationSidecarWidth(200, 1200), 320);
  assert.equal(clampConversationSidecarWidth(880, 1440), 880);
  assert.equal(clampConversationSidecarWidth(1000, 1280), 920);
});
