import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";


test("retirement worker clears only LiOS caches, unregisters, and reloads controlled clients", async () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "client/public/sw.js"), "utf8");
  const listeners = new Map<string, (event: any) => void>();
  const deletedCaches: string[] = [];
  const navigatedClients: string[] = [];
  let unregistered = false;
  let skippedWaiting = false;

  const self = {
    addEventListener(type: string, listener: (event: any) => void) {
      listeners.set(type, listener);
    },
    skipWaiting() {
      skippedWaiting = true;
      return Promise.resolve();
    },
    registration: {
      unregister() {
        unregistered = true;
        return Promise.resolve(true);
      },
    },
    clients: {
      async matchAll() {
        return [
          {
            url: "https://terminal.example.test/terminal",
            async navigate(url: string) {
              navigatedClients.push(url);
            },
          },
        ];
      },
    },
  };

  vm.runInNewContext(source, {
    self,
    caches: {
      async keys() {
        return ["limuria-shell-v1", "unrelated-cache"];
      },
      async delete(key: string) {
        deletedCaches.push(key);
        return true;
      },
    },
  });

  listeners.get("install")?.({});
  let activation: Promise<void> | undefined;
  listeners.get("activate")?.({
    waitUntil(promise: Promise<void>) {
      activation = promise;
    },
  });

  assert.ok(activation, "activation must wait for retirement and navigation to finish");
  await activation;
  assert.equal(skippedWaiting, true);
  assert.deepEqual(deletedCaches, ["limuria-shell-v1"]);
  assert.equal(unregistered, true);
  assert.deepEqual(navigatedClients, ["https://terminal.example.test/terminal"]);
});
