import test from "node:test";
import assert from "node:assert/strict";
import { issueAIConnectionChallenge, acceptsAIConnectionAcknowledgement } from "./aiVerificationChallenge";

test("every AI verification uses a new public one-shot challenge", () => {
  const tokens = new Set(Array.from({ length: 64 }, () => issueAIConnectionChallenge()));
  assert.equal(tokens.size, 64);
  for (const token of tokens) {
    assert.match(token, /^LIOS_AI_OK_[a-f0-9]{24}$/);
    assert.equal(acceptsAIConnectionAcknowledgement(token, token), true);
    assert.equal(acceptsAIConnectionAcknowledgement(` "${token}" `, token), true);
    assert.equal(acceptsAIConnectionAcknowledgement(`${token}.`, token), true);
  }
});

test("static, replayed, malformed, and verbose completions cannot claim a verified model", () => {
  const earlier = issueAIConnectionChallenge();
  const current = issueAIConnectionChallenge();
  for (const reply of [
    "LIOS_AI_OK", earlier, "", "Ready", `${current} with explanation`,
    `${current}\nextra`, `Here is the token: ${current}`,
    `${current.slice(0, -1)}0` === current ? `${current.slice(0, -1)}1` : `${current.slice(0, -1)}0`,
    null, undefined, { text: current },
  ]) {
    assert.equal(acceptsAIConnectionAcknowledgement(reply, current), false);
  }
  assert.equal(acceptsAIConnectionAcknowledgement(current, "LIOS_AI_OK"), false);
  assert.equal(acceptsAIConnectionAcknowledgement(current, "LIOS_AI_OK_" + "z".repeat(24)), false);
});
