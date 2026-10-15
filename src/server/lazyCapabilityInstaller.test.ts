import assert from "node:assert/strict";
import test from "node:test";
import { StrictProvisioningAuthorityError, type ManagedRuntimeOperationResult, type ManagedRuntimeState } from "./pythonRuntimeManager";
import { ensureLazyCapability } from "./lazyCapabilityInstaller";
import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";

function state(selectedPackIds: string[], selectedReleasePackIds: string[] = []): ManagedRuntimeState {
  return {
    manifestVersion: MANAGED_RUNTIME_MANIFEST.manifestVersion,
    installedAt: "2026-10-15T00:00:00.000Z",
    runtimePath: "/tmp/lios-runtime/current",
    rollbackPath: null,
    selectedPackIds,
    selectedReleasePackIds,
    packageOutput: "",
    installedSpecs: [],
    hashVerified: true,
    verificationWarnings: [],
  };
}

test("lazy capability install is a no-op when the required managed packs are already present", async () => {
  let installs = 0;
  const result = await ensureLazyCapability(
    "forecasting",
    {},
    {
      readState: () => state(["core", "forecasting", "fixed-income", "econometrics", "optimization", "ml"]),
      pythonAvailable: () => true,
      installRuntime: async () => {
        installs += 1;
        throw new Error("installer must not run");
      },
    },
  );

  assert.equal(result.status, "already_available");
  assert.equal(result.runtimePackId, "quant");
  assert.equal(installs, 0);
});

test("heavyweight capability packs require explicit consent before provisioning", async () => {
  let installs = 0;
  const result = await ensureLazyCapability(
    "document-intelligence",
    {},
    {
      readState: () => state(["core"]),
      pythonAvailable: () => true,
      installRuntime: async () => {
        installs += 1;
        throw new Error("installer must not run without consent");
      },
    },
  );

  assert.equal(result.status, "consent_required");
  assert.equal(result.runtimePackId, "research");
  assert.equal(result.requiresConsent, true);
  assert.equal(installs, 0);
});

test("approved lazy install preserves existing low-level packs and release-pack metadata", async () => {
  const previous = state(["core", "research-sec"], ["research"]);
  let receivedPackIds: string[] = [];
  let receivedReleasePackIds: string[] = [];
  let receivedStrictAuthority: unknown;
  const installedState = state(["core", "research-sec", "fixed-income", "econometrics", "forecasting", "optimization", "ml"], ["research"]);
  const operation: ManagedRuntimeOperationResult = { state: installedState, detail: "installed" };
  const strictProvisioningAuthority = {
    provisionManagedRuntime: async () => ({ packageOutput: "ok", installedPackages: {} }),
  };

  const result = await ensureLazyCapability(
    "fixed-income",
    {
      consentToHeavyweight: true,
      runtimeInstallOptions: { isolationMode: "strict", strictProvisioningAuthority },
    },
    {
      readState: () => previous,
      pythonAvailable: () => true,
      installRuntime: async (packIds, releasePackIds, options) => {
        receivedPackIds = packIds;
        receivedReleasePackIds = releasePackIds;
        receivedStrictAuthority = options.strictProvisioningAuthority;
        return operation;
      },
    },
  );

  assert.equal(result.status, "installed");
  assert.equal(result.runtimePackId, "quant");
  assert.ok(receivedPackIds.includes("research-sec"));
  for (const id of ["core", "fixed-income", "econometrics", "forecasting", "optimization", "ml"]) {
    assert.ok(receivedPackIds.includes(id), `expected ${id} to be preserved/resolved`);
  }
  assert.deepEqual(receivedReleasePackIds, ["research"]);
  assert.equal(receivedStrictAuthority, strictProvisioningAuthority);
});

test("lazy installation cannot downgrade strict provisioning to legacy host pip", async () => {
  await assert.rejects(
    () => ensureLazyCapability(
      "fixed-income",
      {
        consentToHeavyweight: true,
        runtimeInstallOptions: { isolationMode: "legacy-host" },
      },
      { readState: () => state(["core"]), pythonAvailable: () => true },
    ),
    (error: unknown) => error instanceof StrictProvisioningAuthorityError && error.code === "strict_provisioning_authority_missing",
  );
});

test("local-ai never silently downloads a model or package", async () => {
  let installs = 0;
  const result = await ensureLazyCapability(
    "local-model",
    { consentToHeavyweight: true },
    {
      readState: () => state(["core"]),
      installRuntime: async () => {
        installs += 1;
        throw new Error("local AI setup must remain user supplied");
      },
    },
  );

  assert.equal(result.status, "external_setup_required");
  assert.equal(result.runtimePackId, "local-ai");
  assert.equal(installs, 0);
});

test("unknown capabilities are not converted into arbitrary package installs", async () => {
  let installs = 0;
  const result = await ensureLazyCapability(
    "made-up-capability",
    { consentToHeavyweight: true },
    {
      readState: () => state(["core"]),
      installRuntime: async () => {
        installs += 1;
        throw new Error("unknown capability must not install");
      },
    },
  );

  assert.equal(result.status, "not_managed");
  assert.equal(result.runtimePackId, null);
  assert.equal(installs, 0);
});

test("SI-07.09 a saved pack list is not availability when managed Python is missing", async () => {
  let installs = 0;
  const result = await ensureLazyCapability("forecasting", {}, {
    readState: () => state(["core", "forecasting", "fixed-income", "econometrics", "optimization", "ml"]),
    pythonAvailable: () => false,
    installRuntime: async () => { installs++; throw new Error("silent repair forbidden"); },
  });
  assert.equal(result.status, "runtime_not_ready");
  assert.match(result.detail, /corrupt/);
  assert.equal(installs, 0, "Doctor must repair; lazy availability cannot trigger mutation");
});

test("SI-07.09 incompatible, unverified and integrity-failed runtime states are never labelled available", async () => {
  const allPacks = ["core", "forecasting", "fixed-income", "econometrics", "optimization", "ml"];
  const scenarios: Array<{ state: ManagedRuntimeState; expected: string }> = [
    { state: { ...state(allPacks), manifestVersion: "outdated-manifest" }, expected: "incompatible" },
    { state: { ...state(allPacks), hashVerified: false }, expected: "unverified" },
    { state: { ...state(allPacks), verificationWarnings: ["Unexpected package"] }, expected: "integrity_failed" },
  ];
  for (const scenario of scenarios) {
    const result = await ensureLazyCapability("forecasting", { consentToHeavyweight: true }, {
      readState: () => scenario.state,
      pythonAvailable: () => true,
      installRuntime: async () => { throw new Error("must not silently mutate a broken runtime"); },
    });
    assert.equal(result.status, "runtime_not_ready");
    assert.match(result.detail, new RegExp(scenario.expected));
  }
});

test("SI-07.09 broken installed base must go to Doctor rather than expand new packs", async () => {
  const cases: Array<{ name: string; record: ManagedRuntimeState; pythonAvailable: boolean }> = [
    { name: "missing executable", record: state(["core"]), pythonAvailable: false },
    { name: "manifest drift", record: { ...state(["core"]), manifestVersion: "stale" }, pythonAvailable: true },
    { name: "unverified installation", record: { ...state(["core"]), hashVerified: false }, pythonAvailable: true },
    { name: "integrity failure", record: { ...state(["core"]), verificationWarnings: ["bad package"] }, pythonAvailable: true },
  ];
  for (const scenario of cases) {
    let calls = 0;
    const result = await ensureLazyCapability(
      "forecasting",
      { consentToHeavyweight: true },
      {
        readState: () => scenario.record,
        pythonAvailable: () => scenario.pythonAvailable,
        installRuntime: async () => {
          calls += 1;
          throw new Error("lazy expansion must not repair the existing managed runtime");
        },
      },
    );
    assert.equal(result.status, "runtime_not_ready", scenario.name);
    assert.equal(calls, 0, scenario.name);
  }
});

test("SI-07.09 fresh installation without an existing runtime still respects the consent gate", async () => {
  let installed = 0;
  const result = await ensureLazyCapability("forecasting", {}, {
    readState: () => null,
    pythonAvailable: () => { throw new Error("no current runtime to probe"); },
    installRuntime: async () => {
      installed += 1;
      throw new Error("cannot install without approval");
    },
  });
  assert.equal(result.status, "consent_required");
  assert.equal(installed, 0);
});
