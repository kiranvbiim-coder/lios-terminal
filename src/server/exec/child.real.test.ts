// Written for LiOS, GM-10a. Environment isolation of the child_process adapter (POSIX; not verified on Windows).
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { buildChildEnv, isSecretEnvName } from "./env";
import { createProcessSupervisor } from "./supervisor";
import { nodeArgv } from "./supervisor.real.test-support";

const SECRET_NAME = "LIOS_TEST_API_TOKEN";
const PLAIN_NAME = "LIOS_TEST_PLAIN";
const PRINT_ENV = `process.stdout.write(JSON.stringify({ secret: process.env.${SECRET_NAME} ?? null, plain: process.env.${PLAIN_NAME} ?? null, path: process.env.PATH ?? null }))`;

describe("child environment", () => {
  beforeEach(() => {
    process.env[SECRET_NAME] = "parent-secret";
    process.env[PLAIN_NAME] = "parent-plain";
  });
  afterEach(() => {
    delete process.env[SECRET_NAME];
    delete process.env[PLAIN_NAME];
  });

  it("does not leak secret-named or non-allow-listed parent variables by default", { timeout: 30_000 }, async () => {
    const supervisor = createProcessSupervisor();
    const exit = await (await supervisor.spawn({ mode: "child", argv: nodeArgv(PRINT_ENV) })).wait();
    const seen = JSON.parse(exit.stdout) as { secret: string | null; plain: string | null; path: string | null };
    assert.equal(seen.secret, null);
    assert.equal(seen.plain, null);
    assert.equal(seen.path, process.env.PATH ?? null);
    await supervisor.shutdown();
  });

  it("passes secrets only when given explicitly in env", { timeout: 30_000 }, async () => {
    const supervisor = createProcessSupervisor();
    const exit = await (
      await supervisor.spawn({ mode: "child", argv: nodeArgv(PRINT_ENV), env: { [SECRET_NAME]: "explicit" } })
    ).wait();
    assert.equal((JSON.parse(exit.stdout) as { secret: string }).secret, "explicit");
    await supervisor.shutdown();
  });

  it("buildChildEnv drops secret-looking inherited names and keeps allow-listed ones", () => {
    const env = buildChildEnv(
      { EXTRA: "1" },
      { PATH: "/bin", HOME: "/h", LANG: "C", SESSION_ID: "s", PATH_TOKEN: "t", UNLISTED: "u", TERM: undefined },
    );
    assert.deepEqual(env, { PATH: "/bin", HOME: "/h", LANG: "C", EXTRA: "1" });
    for (const name of ["API_KEY", "GITHUB_TOKEN", "CLIENT_SECRET", "DB_PASSWORD", "AWS_CREDENTIALS", "COOKIE_JAR", "SESSION_ID"]) {
      assert.equal(isSecretEnvName(name), true, name);
    }
    assert.equal(isSecretEnvName("PATH"), false);
  });
});
