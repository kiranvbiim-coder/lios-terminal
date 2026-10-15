"use strict";

const path = require("node:path");
const {
  clearDataRootPointer,
  moveDataRoot,
  prepareDataRoot,
  readMarker,
  resolveDataRoot,
  restoreDataRootPointer,
} = require("./dataRootCore.cjs");

class GovernedDataMigrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GovernedDataMigrationError";
    this.code = code;
  }
}

let migrationInProgress = false;

function restorePreviousSelection(previous, { env, homedir, cwd }) {
  if (previous.source === "pointer") {
    restoreDataRootPointer({ root: previous.root, env, homedir });
  } else {
    clearDataRootPointer({ env, homedir });
  }
  const restored = resolveDataRoot({ env, homedir, cwd });
  if (restored.root !== previous.root) {
    throw new Error("The previous LiOS data root could not be re-selected.");
  }
  return restored;
}

async function migrateDataRootSafely({
  targetRoot,
  env = process.env,
  homedir,
  cwd,
  validateActivatedRoot,
}) {
  if (migrationInProgress) {
    throw new GovernedDataMigrationError("migration_in_progress", "A LiOS data migration is already in progress.");
  }

  const previous = prepareDataRoot({ env, homedir, cwd });
  if (typeof targetRoot !== "string" || !path.isAbsolute(targetRoot)) {
    throw new Error("Choose an absolute folder path.");
  }
  const target = path.resolve(targetRoot);

  if (target === previous.root) {
    return { status: "already_current", from: previous.root, to: previous.root, files: 0, bytes: 0 };
  }

  if (previous.source === "LIOS_DATA_ROOT" || previous.source === "LIMURIA_DATA_DIR") {
    throw new GovernedDataMigrationError(
      "external_root_override",
      "LiOS cannot activate a moved data root while an environment data-root override is active.",
    );
  }

  migrationInProgress = true;
  try {
    const moved = moveDataRoot({ from: previous.root, to: target, env, homedir });
    let activated;
    let valid = false;
    try {
      activated = prepareDataRoot({ env, homedir, cwd });
      const sourceMarker = readMarker(previous.root);
      const targetMarker = readMarker(target);
      valid = activated.root === target
        && activated.source === "pointer"
        && Boolean(sourceMarker)
        && Boolean(targetMarker)
        && sourceMarker.rootId === targetMarker.rootId;
      if (valid && validateActivatedRoot) {
        valid = Boolean(await validateActivatedRoot({ resolution: activated, previous, migration: moved }));
      }
    } catch {
      valid = false;
    }

    if (valid) {
      return { status: "migrated", ...moved };
    }

    try {
      restorePreviousSelection(previous, { env, homedir, cwd });
    } catch {
      throw new GovernedDataMigrationError(
        "rollback_failed",
        "LiOS copied the data but could not safely restore the previous data-root selection after validation failed.",
      );
    }

    return { status: "rollback_restored", ...moved };
  } finally {
    migrationInProgress = false;
  }
}

module.exports = {
  GovernedDataMigrationError,
  migrateDataRootSafely,
};
