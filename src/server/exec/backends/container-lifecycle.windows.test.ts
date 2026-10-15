import assert from "node:assert/strict";
import test from "node:test";
import { createContainerExecutionLifecycle, type ContainerControlRunner } from "./container-lifecycle";

const WINDOWS_DOCKER_TARGET = "npipe:////./pipe/docker_engine";

test("Windows Docker lifecycle pins the local named pipe for cleanup and extinction proof", async () => {
  const commands: string[][] = [];
  const runner: ContainerControlRunner = async (argv) => {
    commands.push([...argv]);
    return argv[2] === "inspect"
      ? { code: 1, stdout: "", stderr: "No such container" }
      : { code: 0, stdout: "", stderr: "" };
  };
  const lifecycle = createContainerExecutionLifecycle({
    engine: "docker",
    engineTarget: WINDOWS_DOCKER_TARGET,
    generationId: "lios-exec-windows-lifecycle",
    runner,
    retryDelayMs: 0,
  });
  await lifecycle.finalize();
  assert.deepEqual(commands[0]?.slice(0, 3), [
    "docker",
    `--host=${WINDOWS_DOCKER_TARGET}`,
    "rm",
  ]);
  assert.deepEqual(commands[1]?.slice(0, 3), [
    "docker",
    `--host=${WINDOWS_DOCKER_TARGET}`,
    "inspect",
  ]);
});

test("container lifecycle rejects remote or ambiguous Windows named pipes", () => {
  for (const target of [
    "npipe:////remote/pipe/docker_engine",
    "npipe:////./pipe/../docker_engine",
    "tcp://127.0.0.1:2375",
  ]) {
    assert.throws(
      () => createContainerExecutionLifecycle({
        engine: "docker",
        engineTarget: target,
        generationId: "lios-exec-invalid-target",
      }),
      /explicit local unix:\/\/ socket or Windows Docker npipe:\/\/ endpoint/,
    );
  }
});

test("Podman does not inherit the Windows Docker named-pipe transport", () => {
  assert.throws(
    () => createContainerExecutionLifecycle({
      engine: "podman",
      engineTarget: WINDOWS_DOCKER_TARGET,
      generationId: "lios-exec-podman-windows-pipe",
    }),
    /explicit local unix:\/\/ socket or Windows Docker npipe:\/\/ endpoint/,
  );
});
