import assert from "node:assert/strict";
import test from "node:test";
import { playReplySpeech, prepareReplySpeech, ReplySpeechError } from "./replySpeech";

const speech = (input: string) => {
  const result = prepareReplySpeech(input);
  assert.ok(result.kind === "speech" || result.kind === "screen_detail");
  return result.text;
};

test("speech uses visible Markdown meaning and table headers without changing financial values or citations", () => {
  // Adapted OpenClaw speech-text/prepare-text cases; same LiOS parsed tree as the on-screen answer.
  const input = "## Revenue **review**\n\nRead the [filing](https://example.invalid/not-spoken).\n\n| Period | Revenue | Margin |\n|---|---|---|\n| FY24 | $1,250.00 | -3.50% |\n| FY25 | €2.75 | +0.125% |\n\n> Ordinary _prose_ with `foo_bar`. [42]\n\n✨ ✨ ✨\nReally!!!!!\n\n404. Not found\n\n<<NAVIGATE:settings>>";
  const result = speech(input);
  assert.match(result, /Revenue review/);
  assert.match(result, /Read the filing/);
  assert.match(result, /Period: FY24\. Revenue: \$1,250\.00\. Margin: -3\.50%/);
  assert.match(result, /Period: FY25\. Revenue: €2\.75\. Margin: \+0\.125%/);
  assert.match(result, /Ordinary prose with foo_bar\. \[42\]/);
  assert.match(result, /Really!/);
  assert.match(result, /404\. Not found/);
  assert.doesNotMatch(result, /https:\/\/example|[|`#✨]|<<NAVIGATE/);
  for (const [text, expected] of [["foo_bar _italic_ baz_qux", "foo_bar italic baz_qux"], ["привет_мир_тест", "привет_мир_тест"], ["東京_駅_前", "東京_駅_前"], ["• item", "item"]]) assert.equal(speech(text), expected);
});

test("half-fenced-code boundary is inclusive and nested fences count but inline code does not", () => {
  for (const [code, expected] of [["1234567", "speech"], ["12345678", "screen_detail"], ["12345  ", "speech"], ["123456  ", "screen_detail"]] as const) {
    assert.equal(prepareReplySpeech(`\`\`\`\n${code}\n\`\`\``).kind, expected);
  }
  assert.equal(prepareReplySpeech('- ```js\n  const detailedAnswer = "this body dominates the reply";\n  ```').kind, "screen_detail");
  assert.equal(prepareReplySpeech('> ```js\n> const detailedAnswer = "this body dominates the reply";\n> ```').kind, "screen_detail");
  assert.equal(prepareReplySpeech("Ordinary prose with `inline_code` and no fenced program.").kind, "speech");
  const prose = "This explanation is much longer than the tiny example and remains useful spoken context. ".repeat(3);
  assert.match(speech(`${prose}\n\n\`\`\`ts\nconst ready = true;\n\`\`\``), /const ready = true;/);
  assert.equal(speech("```\n" + "a".repeat(500) + "\n```"), "I've put the detailed response on screen.");
});

test("empty projection makes no request; four-thousand-character boundary refuses rather than silently clipping", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("must not dispatch"); };
  try {
    assert.equal(prepareReplySpeech("a".repeat(4_000)).kind, "speech");
    assert.equal(prepareReplySpeech("a".repeat(4_001)).kind, "too_long");
    assert.equal(await playReplySpeech("---\n\n✨ ✨", new AbortController().signal), "empty");
    await assert.rejects(playReplySpeech("a".repeat(4_001), new AbortController().signal), error => error instanceof ReplySpeechError && error.reason === "too_long");
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});

test("stopped, rejected and late-error playback releases audio URLs and exposes only safe failures", async () => {
  const original = { fetch: globalThis.fetch, Audio: globalThis.Audio, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const players: Player[] = [];
  const revoked: string[] = [];
  let rejected = false;
  class Player {
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    paused = false;
    cleared = false;
    constructor(_url: string) { players.push(this); }
    play() { return rejected ? Promise.reject(new Error("private platform diagnostic")) : Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute(name: string) { if (name === "src") this.cleared = true; }
  }
  globalThis.Audio = Player as unknown as typeof Audio;
  globalThis.fetch = async () => new Response("synthetic audio", { headers: { "content-type": "audio/wav" } });
  URL.createObjectURL = () => `blob:proof-${players.length}`;
  URL.revokeObjectURL = url => { revoked.push(url); };
  const started = async () => { await new Promise(resolve => setImmediate(resolve)); };
  try {
    const abort = new AbortController();
    const stopped = playReplySpeech("Speak a reply", abort.signal);
    await started();
    abort.abort("private abort diagnostic");
    await assert.rejects(stopped, error => error instanceof DOMException && error.name === "AbortError" && !error.message.includes("private"));
    assert.equal(players[0].paused && players[0].cleared, true);
    rejected = true;
    await assert.rejects(playReplySpeech("Another reply", new AbortController().signal), error => error instanceof ReplySpeechError && !error.message.includes("private"));
    rejected = false;
    const lateError = playReplySpeech("Late failure", new AbortController().signal);
    await started(); players[2].onerror!();
    await assert.rejects(lateError, ReplySpeechError);
    const complete = playReplySpeech("Final reply", new AbortController().signal);
    await started(); players[3].onended!();
    assert.equal(await complete, "played");
    assert.deepEqual(revoked, ["blob:proof-0", "blob:proof-1", "blob:proof-2", "blob:proof-3"]);
    assert.equal(players.every(player => player.paused && player.cleared), true);
    globalThis.fetch = async () => new Response("private provider diagnostic", { status: 422 });
    await assert.rejects(playReplySpeech("Refused request", new AbortController().signal), error => error instanceof ReplySpeechError && !error.message.includes("private"));
  } finally {
    globalThis.fetch = original.fetch; globalThis.Audio = original.Audio;
    URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke;
  }
});
