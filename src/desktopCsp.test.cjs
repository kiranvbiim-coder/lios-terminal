const test = require("node:test");
const assert = require("node:assert/strict");
const { imgSrcDirective } = require("./desktopCsp.cjs");

test("open mode (default) keeps https images", () => {
  assert.equal(imgSrcDirective({}), "'self' data: blob: https:");
  assert.equal(imgSrcDirective({ LIOS_EGRESS_MODE: "open", LIOS_EGRESS_ALLOW: "a.com" }), "'self' data: blob: https:");
});

test("allowlist mode emits host and suffix rules only", () => {
  const env = { LIOS_EGRESS_MODE: "allowlist", LIOS_EGRESS_ALLOW: "images.example.com, *.cdn.example.org,10.0.0.1,192.168.0.0/16" };
  assert.equal(imgSrcDirective(env), "'self' data: blob: https://images.example.com https://*.cdn.example.org");
});

test("allowlist mode ignores malformed entries and empty lists", () => {
  const env = { LIOS_EGRESS_MODE: "allowlist", LIOS_EGRESS_ALLOW: ",;x y,*.,https://evil.com,ok.com;script-src," };
  assert.equal(imgSrcDirective(env), "'self' data: blob:");
  assert.equal(imgSrcDirective({ LIOS_EGRESS_MODE: "allowlist" }), "'self' data: blob:");
});

test("offline mode allows no remote images", () => {
  assert.equal(imgSrcDirective({ LIOS_EGRESS_MODE: "offline", LIOS_EGRESS_ALLOW: "a.com" }), "'self' data: blob:");
});
