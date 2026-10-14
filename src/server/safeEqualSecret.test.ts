// Ported from openclaw/openclaw v2026.9.7 src/security/secret-equal.test.ts (MIT, see THIRD_PARTY_NOTICES.md);
// vitest/vi.mock replaced by node:test, and the padding assertion made observable without mocking crypto.
import assert from "node:assert/strict";
import test from "node:test";
import { safeEqualSecret } from "./safeEqualSecret";

test("compares secrets, treating missing values as unequal", () => {
  const cases: Array<[string | null | undefined, string | null | undefined, boolean]> = [
    ["secret-token", "secret-token", true],
    ["secret-token", "secret-tokEn", false],
    ["", "", true],
    ["", "secret", false],
    [undefined, "secret", false],
    [null, "secret", false],
    ["secret", undefined, false],
  ];
  for (const [left, right, expected] of cases) assert.equal(safeEqualSecret(left, right), expected, `${String(left)} vs ${String(right)}`);
});

test("compares Unicode by exact UTF-8 bytes without normalization", () => {
  assert.equal(safeEqualSecret("é", "e\u0301"), false);
});

test("unequal lengths never throw (timingSafeEqual would) and a trailing NUL is not ignored", () => {
  assert.doesNotThrow(() => safeEqualSecret("é", "much-longer-秘密"));
  assert.equal(safeEqualSecret("é", "much-longer-秘密"), false);
  assert.equal(safeEqualSecret("a", "a\0"), false);
  assert.equal(safeEqualSecret("a\0", "a"), false);
});
