import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readDesktopHandoff } from "./desktopHandoff";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-handoff-"));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
let counter = 0;
const fdWith = (text: string) => { const file = path.join(dir, `stdin-${counter += 1}`); fs.writeFileSync(file, text); return fs.openSync(file, "r"); };
const on = { LIOS_DESKTOP_HANDOFF_ON_STDIN: "1" } as NodeJS.ProcessEnv;
const token = "t".repeat(43);

test("handoff reads the token and the optional vault secret up to the terminator", () => {
  assert.deepEqual(readDesktopHandoff(on, fdWith(`LIOS-LOCAL-TOKEN ${token}\nLIOS-VAULT-SECRET vault-secret-0123456789\nLIOS-HANDOFF-END\n`)), { localToken: token, vaultSecret: "vault-secret-0123456789" });
  assert.deepEqual(readDesktopHandoff(on, fdWith(`LIOS-LOCAL-TOKEN ${token}\r\nLIOS-HANDOFF-END\r\n`)), { localToken: token, vaultSecret: null }, "vault secret is optional; CRLF is tolerated");
});

test("handoff ignores everything after the terminator and unknown or empty lines", () => {
  const result = readDesktopHandoff(on, fdWith(`junk\nLIOS-LOCAL-TOKEN ${token}\nLIOS-VAULT-SECRET \nLIOS-HANDOFF-END\nLIOS-VAULT-SECRET injected-after-end\n`));
  assert.deepEqual(result, { localToken: token, vaultSecret: null });
});

test("handoff is read only when the launcher asked for it", () => {
  assert.equal(readDesktopHandoff({}, fdWith(`LIOS-LOCAL-TOKEN ${token}\nLIOS-HANDOFF-END\n`)), null);
});

test("an empty or unterminated handoff yields no token so startup can refuse", () => {
  assert.deepEqual(readDesktopHandoff(on, fdWith(""), 200), { localToken: null, vaultSecret: null });
  assert.deepEqual(readDesktopHandoff(on, fdWith("something else\nLIOS-HANDOFF-END\n")), { localToken: null, vaultSecret: null });
});
