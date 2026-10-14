import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const root = process.cwd();
const validator = path.join(root, "script/validate_p1b_identity_acceptance.ts");
const source = fs.readFileSync(validator, "utf8");
const files = [...source.matchAll(/read\("([^"]+)"\)/g)].map((match) => match[1]);
files.push("shared/schemaCore.ts", "shared/schemaProjects.ts");

function check(mutate) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p1b-"));
  try {
    for (const file of new Set(files)) {
      const destination = path.join(fixture, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, file), destination);
    }
    mutate?.(fixture);
    return spawnSync(process.execPath, ["--import", path.join(root, "node_modules/tsx/dist/loader.mjs"), validator], {
      cwd: fixture, encoding: "utf8", timeout: 30_000,
    });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

test("P1B accepts decomposed canonical ownership with compatibility exports", () => {
  const result = check();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ownership.exactUserAndOrganization, true);
});

for (const [module, tables] of Object.entries({
  schemaCore: ["projects"],
  schemaProjects: ["projectChats", "projectSessions", "projectArtifacts"],
})) {
  for (const table of tables) {
    for (const field of ["ownerUserId", "organizationId"]) {
      test(`P1B rejects missing ${table}.${field} without borrowing a neighbouring table`, () => {
        const result = check((fixture) => {
          const file = path.join(fixture, `shared/${module}.ts`);
          const text = fs.readFileSync(file, "utf8");
          const start = text.indexOf(`export const ${table} =`);
          assert.notEqual(start, -1);
          const next = text.indexOf("\nexport ", start + 1);
          const end = next < 0 ? text.length : next;
          const fragment = text.slice(start, end);
          assert.match(fragment, new RegExp(`${field}:`));
          fs.writeFileSync(file, text.slice(0, start) + fragment.replace(`${field}:`, "removedOwnershipField:") + text.slice(end));
        });
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, new RegExp(`${table} must retain ${field}`));
      });
    }
  }
  test(`P1B rejects an ownership module missing from the compatibility barrel: ${module}`, () => {
    const result = check((fixture) => {
      const file = path.join(fixture, "shared/schema.ts");
      const text = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, text.replace(`export * from "./${module}";`, ""));
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`ownership module must remain exported: ${module}`));
  });
}
