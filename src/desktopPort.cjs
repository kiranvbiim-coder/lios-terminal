"use strict";
/**
 * GM-03 / Q5: the loopback port the desktop's local server listens on.
 *
 * The renderer keeps per-origin state (localStorage) and the origin includes the port, so a port that changes
 * every launch would silently discard it. The port is therefore chosen once and then persisted:
 *   - a saved port that is still free is reused;
 *   - an existing install (it already has data) keeps the historical 5052 so nothing is lost on upgrade;
 *   - a new install gets a random free port so there is no well-known address to probe.
 * The per-launch trust token, not the port, is what keeps other local processes out.
 */
const fs = require("node:fs");
const path = require("node:path");

const LEGACY_PORT = 5052;
const LEGACY_SCAN = 20;
const RANDOM_RANGE = [20000, 60000];

function readSavedPort(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Number.isInteger(parsed.port) && parsed.port > 1023 && parsed.port < 65536 ? parsed.port : null;
  } catch {
    return null;
  }
}

function saveEquals(file, port) {
  return readSavedPort(file) === port;
}

function persist(file, port) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ port, chosenAt: new Date().toISOString() })}\n`, { encoding: "utf8", mode: 0o600 });
}

/**
 * @param {{ file: string, existingInstall: boolean, isFree: (port: number) => Promise<boolean>, random?: () => number, preferredFromEnv?: number|null }} options
 */
async function choosePersistentPort({ file, existingInstall, isFree, random = Math.random, preferredFromEnv = null }) {
  if (preferredFromEnv) {
    // An operator-supplied PORT is honoured as before (first free port at or after it) and never persisted.
    for (let offset = 0; offset <= LEGACY_SCAN; offset += 1) if (await isFree(preferredFromEnv + offset)) return preferredFromEnv + offset;
    throw new Error(`No available local port between ${preferredFromEnv} and ${preferredFromEnv + LEGACY_SCAN}.`);
  }
  const saved = readSavedPort(file);
  if (saved && (await isFree(saved))) return saved;

  let chosen = null;
  if (existingInstall) {
    for (let offset = 0; offset <= LEGACY_SCAN && chosen === null; offset += 1) if (await isFree(LEGACY_PORT + offset)) chosen = LEGACY_PORT + offset;
  } else {
    const [low, high] = RANDOM_RANGE;
    for (let attempt = 0; attempt < 50 && chosen === null; attempt += 1) {
      const candidate = low + Math.floor(random() * (high - low));
      if (await isFree(candidate)) chosen = candidate;
    }
  }
  if (chosen === null) throw new Error("No available local port for the LiOS server.");
  if (!saveEquals(file, chosen)) persist(file, chosen);
  return chosen;
}

module.exports = { LEGACY_PORT, choosePersistentPort, readSavedPort };
