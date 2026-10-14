import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";

/** Describes ownership and release evidence, not a second installer or a claim of packaged health. */
export const SP01_DEPENDENCY_INVENTORY = {
  schemaVersion: 1,
  components: [
    {
      id: "desktop-shell",
      delivery: "bundled",
      authority: "main.cjs / electron-builder",
      provenance: "package.json#build; package-lock.json#node_modules/electron",
      verification: "packaged Electron launch and asar-integrity fuse",
      repair: "reinstall signed application; leave user data root intact",
    },
    {
      id: "native-pty",
      delivery: "bundled",
      authority: "terminal PTY adapter / electron-builder afterPack",
      provenance: "package-lock.json#node_modules/@lydell/node-pty; script/afterPackCopyNodeModules.cjs",
      verification: "load platform-native PTY binary in packaged target",
      repair: "reinstall application; do not download an arbitrary native binary",
    },
    {
      id: "home-server-and-renderer",
      delivery: "bundled",
      authority: "main.cjs / server startup",
      provenance: "package.json#build.files (dist, main.cjs, preload.cjs)",
      verification: "packaged sign-in, Project/Chat and server startup",
      repair: "reinstall application; preserve data root",
    },
    {
      id: "database-and-migrations",
      delivery: "bundled-and-user-data",
      authority: "db.ts / dataRoot.ts / pgliteBackup.ts",
      provenance: "package-lock.json#node_modules/@electric-sql/pglite; package.json#build.extraResources (migrations)",
      verification: "database ownership, migration backup and reopen on same data root",
      repair: "restore through canonical database/backup path; never replace user data",
    },
    {
      id: "vault-and-storage",
      delivery: "bundled-and-user-data",
      authority: "desktopSecretCustody.cjs / credentialVault.ts / dataRoot.ts",
      provenance: "package.json#build.files (desktopSecretCustody.cjs, dataRootCore.cjs)",
      verification: "OS-protected secret custody and data-root continuity after restart",
      repair: "restore user-owned backup; never regenerate over an initialized root",
    },
    {
      id: "governed-execution",
      delivery: "bundled",
      authority: "server/exec / GM-11 execution authority",
      provenance: "package.json#build.files (dist); docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md",
      verification: "packaged exact-operation approval, sandbox, streamed result and receipt",
      repair: "reinstall application; refuse execution when authority is unavailable",
    },
    {
      id: "managed-python-core",
      delivery: "managed",
      authority: "pythonRuntimeManager.ts / managedRuntimeReconciler.ts",
      provenance: "runtimeManifest.ts; python-service/requirements/core.lock.txt (release artifact)",
      verification: "manifest version, executable, selected pack, allow-list and platform wheel hashes",
      repair: "existing /api/setup/python-runtime/install reconciliation; rollback prior runtime",
      manifestVersion: MANAGED_RUNTIME_MANIFEST.manifestVersion,
      releaseHashesRequired: true,
    },
    {
      id: "python-sidecar-assets",
      delivery: "bundled",
      authority: "desktopPythonSidecar.cjs / pythonService.ts",
      provenance: "package.json#build.extraResources (python-sidecar-dist, python-service)",
      verification: "packaged sidecar ready/health probe",
      repair: "reinstall packaged assets; preserve data root",
    },
  ],
} as const;
