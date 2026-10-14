import assert from "node:assert/strict";
import fs from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateSourceDistribution } from "./source_distribution";
import {
  collectPreflightChecks,
  formatPreflightResult,
} from "./release_preflight";

const CURRENT_JOURNAL = JSON.stringify({
  entries: [{ idx: 41, tag: "0041_user_persona_preferences" }],
});

function byId(results: ReturnType<typeof collectPreflightChecks>, id: string) {
  const result = results.find((entry) => entry.id === id);
  assert.ok(result, `missing preflight result ${id}`);
  return result;
}

test("CI mode passes code capability checks while classifying production evidence as external", () => {
  const results = collectPreflightChecks({
    mode: "ci",
    env: {},
    cwd: "/repo/src",
    platform: "linux",
    existsSync: () => true,
    readFileSync: () => CURRENT_JOURNAL,
    execFile: (file) => {
      if (file === "python3") return "Python 3.12.6";
      throw new Error(`unexpected executable ${file}`);
    },
  });

  assert.equal(byId(results, "source_migration").pass, true);
  assert.equal(byId(results, "production_node_env").pass, true);
  assert.equal(byId(results, "legacy_hmac_disabled").pass, true);
  assert.equal(byId(results, "legacy_device_header_disabled").pass, true);
  assert.equal(byId(results, "legacy_default_admin_removed").pass, true);
  assert.equal(byId(results, "asymmetric_license_crypto").pass, true);
  assert.equal(byId(results, "python").pass, true);
  assert.equal(byId(results, "asymmetric_license_keys").required, false);
  assert.equal(byId(results, "beta_data").required, false);
  assert.equal(byId(results, "desktop_signing").required, false);
  assert.equal(byId(results, "desktop_notarization").required, false);
  assert.equal(byId(results, "desktop_update_feed").required, false);
  assert.match(formatPreflightResult(byId(results, "desktop_signing")), /^EXTERNAL /);

  const blocked = results.filter((result) => result.required && !result.pass);
  assert.deepEqual(blocked, []);
});


test("desktop distribution scripts cannot silently produce unsigned macOS or Windows releases", () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts?: Record<string, string>;
    build?: {
      appId?: string;
      productName?: string;
      publish?: Array<{ provider?: string; url?: string }>;
      mac?: { identity?: string | null; hardenedRuntime?: boolean; target?: string[]; entitlements?: string; entitlementsInherit?: string };
    };
  };
  const desktopBuildWrapper = fs.readFileSync(new URL("./desktop_build.cjs", import.meta.url), "utf8");
  const desktopMainProcess = fs.readFileSync(new URL("../main.cjs", import.meta.url), "utf8");
  const desktopSecretCustody = fs.readFileSync(new URL("../desktopSecretCustody.cjs", import.meta.url), "utf8");
  const desktopSelfTest = fs.readFileSync(new URL("../desktopSelfTest.cjs", import.meta.url), "utf8");
  const pythonSidecarBuilder = fs.readFileSync(new URL("./build_python_sidecar.cjs", import.meta.url), "utf8");
  assert.deepEqual(validateSourceDistribution(fileURLToPath(new URL("../../", import.meta.url))), []);

  assert.equal(packageJson.build?.appId, "com.limuria.terminal", "stable bundle/app identity must not drift during naming cleanup");
  assert.equal(packageJson.build?.productName, "LiOS Intelligence Terminal");
  assert.notEqual(packageJson.build?.mac?.identity, null, "mac identity=null explicitly disables signing");
  assert.equal(packageJson.build?.mac?.hardenedRuntime, true, "production macOS packaging must keep Hardened Runtime enabled");
  assert.deepEqual(packageJson.build?.mac?.target, ["dmg", "zip"], "macOS updater releases require both DMG and ZIP targets");
  assert.equal(packageJson.build?.mac?.entitlements, "build-resources/entitlements.mac.plist");
  assert.equal(packageJson.build?.mac?.entitlementsInherit, "build-resources/entitlements.mac.inherit.plist");
  assert.equal(fs.existsSync(new URL("../build-resources/entitlements.mac.plist", import.meta.url)), true);
  assert.equal(fs.existsSync(new URL("../build-resources/entitlements.mac.inherit.plist", import.meta.url)), true);
  assert.equal(packageJson.build?.publish?.[0]?.provider, "generic");
  assert.equal(packageJson.build?.publish?.[0]?.url, "${env.LIOS_UPDATE_URL}");
  assert.match(packageJson.scripts?.["app:dist:mac"] ?? "", /desktop_build\.cjs mac$/);
  assert.match(packageJson.scripts?.["app:dist:win"] ?? "", /desktop_build\.cjs win$/);
  assert.match(desktopBuildWrapper, /forceCodeSigning=true/);
  assert.match(desktopBuildWrapper, /mac\.notarize=true/);
  assert.match(desktopBuildWrapper, /LIOS_UPDATE_URL/);
  assert.doesNotMatch(desktopBuildWrapper, /audience/i);
  assert.doesNotMatch(desktopMainProcess, /client-terminal|DESKTOP_AUDIENCE/);
  assert.match(desktopMainProcess, /app\.isPackaged\s*\?\s*process\.execPath/);
  assert.match(desktopMainProcess, /ELECTRON_RUN_AS_NODE/);
  assert.match(desktopMainProcess, /safeStorage/);
  assert.match(desktopMainProcess, /--desktop-self-test/);
  assert.match(desktopSecretCustody, /vault-master-key\.safe/);
  assert.match(desktopSecretCustody, /round-trip verification failed/);
  assert.match(desktopSelfTest, /native_protected/);
  assert.match(desktopSelfTest, /probeBundledPythonSidecar/);
  assert.match(pythonSidecarBuilder, /PyInstaller/);
  assert.match(desktopBuildWrapper, /python-sidecar-dist/);
  assert.match(desktopMainProcess, /sandbox:\s*true/);
  assert.match(desktopMainProcess, /setWindowOpenHandler/);
  assert.match(desktopMainProcess, /will-navigate/);
  assert.match(JSON.stringify(packageJson), /python-sidecar-dist/);
});

test("desktop preflight rejects missing, insecure, local, and reserved update feeds", () => {
  const base = {
    mode: "desktop" as const,
    cwd: "/repo/src",
    platform: "win32" as const,
    existsSync: () => true,
    readFileSync: () => CURRENT_JOURNAL,
    execFile: (file: string) => {
      if (file === "python3") return "Python 3.12.6";
      throw new Error(`unexpected executable ${file}`);
    },
  };
  for (const LIOS_UPDATE_URL of [
    undefined,
    "http://updates.example.test/lios/",
    "https://localhost/lios/",
    "https://updates.invalid/lios/",
    "not-a-url",
  ]) {
    const results = collectPreflightChecks({
      ...base,
      env: {
        NODE_ENV: "production",
        CSC_LINK: "base64-certificate",
        CSC_KEY_PASSWORD: "certificate-password",
        ...(LIOS_UPDATE_URL ? { LIOS_UPDATE_URL } : {}),
      },
    });
    assert.equal(byId(results, "desktop_update_feed").pass, false);
    assert.equal(byId(results, "desktop_update_feed").required, true);
  }
});

test("desktop preflight requires the self-contained Python sidecar before signed packaging", () => {
  const results = collectPreflightChecks({
    mode: "desktop",
    env: {
      NODE_ENV: "production",
      CSC_LINK: "base64-certificate",
      CSC_KEY_PASSWORD: "certificate-password",
      LIOS_UPDATE_URL: "https://updates.example.test/lios/",
    },
    cwd: "/repo/src",
    platform: "win32",
    existsSync: (target) => {
      const value = String(target);
      return value.endsWith("0041_user_persona_preferences.sql");
    },
    readFileSync: () => CURRENT_JOURNAL,
    execFile: (file) => {
      if (file === "python3") return "Python 3.12.6";
      throw new Error(`unexpected executable ${file}`);
    },
  });
  assert.equal(byId(results, "desktop_python_sidecar_bundle").required, true);
  assert.equal(byId(results, "desktop_python_sidecar_bundle").pass, false);
  assert.match(byId(results, "desktop_python_sidecar_bundle").detail, /python:sidecar:build/);
});

test("preflight rejects unsupported Python runtimes", () => {
  const results = collectPreflightChecks({
    mode: "ci",
    env: {},
    cwd: "/repo/src",
    platform: "linux",
    existsSync: () => true,
    readFileSync: () => CURRENT_JOURNAL,
    execFile: (file) => {
      if (file === "python3") return "Python 3.9.6";
      throw new Error(`unexpected executable ${file}`);
    },
  });
  assert.equal(byId(results, "python").pass, false);
  assert.match(byId(results, "python").detail, />=3\.11,<3\.14/);
});

test("desktop mode rejects non-production runtime and requires target-platform signing", () => {
  const results = collectPreflightChecks({
    mode: "desktop",
    env: {},
    cwd: "/repo/src",
    platform: "linux",
    existsSync: (target) => String(target).endsWith("0041_user_persona_preferences.sql"),
    readFileSync: () => CURRENT_JOURNAL,
    execFile: (file) => {
      if (file === "python3") return "Python 3.12.6";
      throw new Error(`unexpected executable ${file}`);
    },
  });

  assert.equal(byId(results, "production_node_env").pass, false);
  assert.equal(byId(results, "asymmetric_license_keys").pass, false);
  assert.equal(byId(results, "asymmetric_license_keys").required, false);
  assert.equal(byId(results, "beta_data").required, false);
  assert.equal(byId(results, "desktop_signing").pass, false);
  assert.equal(byId(results, "desktop_signing").required, true);
});

test("desktop mode validates a matching macOS signing identity without extra blockers", () => {
  const results = collectPreflightChecks({
    mode: "desktop",
    env: {
      NODE_ENV: "production",
      APPLE_ID: "release@example.test",
      APPLE_APP_SPECIFIC_PASSWORD: "app-specific-password",
      APPLE_TEAM_ID: "TEAMID1234",
      LIOS_UPDATE_URL: "https://updates.example.test/lios/",
    },
    cwd: "/repo/src",
    platform: "darwin",
    existsSync: () => true,
    readFileSync: () => CURRENT_JOURNAL,
    execFile: (file) => {
      if (file === "python3") return "Python 3.12.6";
      if (file === "security") {
        return "  1) ABCDEF1234567890 \"Developer ID Application: Limuria Intelligence LLP (TEAMID1234)\"\n     1 valid identities found";
      }
      throw new Error(`unexpected executable ${file}`);
    },
  });

  assert.equal(byId(results, "production_node_env").pass, true);
  assert.equal(byId(results, "asymmetric_license_keys").required, false);
  assert.equal(byId(results, "beta_data").required, false);
  assert.equal(byId(results, "desktop_signing").pass, true);
  assert.equal(byId(results, "desktop_notarization").pass, true);
  assert.deepEqual(results.filter((result) => result.required && !result.pass), []);
});

test("desktop macOS mode accepts a secret-managed signing certificate before electron-builder imports it", () => {
  const results = collectPreflightChecks({
    mode: "desktop",
    env: {
      NODE_ENV: "production",
      CSC_LINK: "base64-p12",
      CSC_KEY_PASSWORD: "certificate-password",
      APPLE_ID: "release@example.test",
      APPLE_APP_SPECIFIC_PASSWORD: "app-specific-password",
      APPLE_TEAM_ID: "TEAMID1234",
      LIOS_UPDATE_URL: "https://updates.example.test/lios/",
    },
    cwd: "/repo/src",
    platform: "darwin",
    existsSync: () => true,
    readFileSync: () => CURRENT_JOURNAL,
    execFile: (file) => {
      if (file === "python3") return "Python 3.12.6";
      if (file === "security") return "0 valid identities found";
      throw new Error(`unexpected executable ${file}`);
    },
  });

  assert.equal(byId(results, "desktop_signing").pass, true);
  assert.match(byId(results, "desktop_signing").detail, /CSC_LINK/);
  assert.equal(byId(results, "desktop_notarization").pass, true);
  assert.deepEqual(results.filter((result) => result.required && !result.pass), []);
});

test("desktop macOS mode blocks release when notarization credentials are absent", () => {
  const results = collectPreflightChecks({
    mode: "desktop",
    env: { NODE_ENV: "production", LIOS_UPDATE_URL: "https://updates.example.test/lios/" },
    cwd: "/repo/src",
    platform: "darwin",
    existsSync: () => true,
    readFileSync: () => CURRENT_JOURNAL,
    execFile: (file) => {
      if (file === "python3") return "Python 3.12.6";
      if (file === "security") {
        return "  1) ABCDEF1234567890 \"Developer ID Application: Limuria Intelligence LLP (TEAMID1234)\"\n     1 valid identities found";
      }
      throw new Error(`unexpected executable ${file}`);
    },
  });

  assert.equal(byId(results, "desktop_signing").pass, true);
  assert.equal(byId(results, "desktop_notarization").pass, false);
  assert.equal(byId(results, "desktop_notarization").required, true);
  assert.match(formatPreflightResult(byId(results, "desktop_notarization")), /^BLOCKED /);
});

test("desktop mode validates Windows signing credentials", () => {
  const results = collectPreflightChecks({
    mode: "desktop",
    env: {
      NODE_ENV: "production",
      CSC_LINK: "base64-certificate",
      CSC_KEY_PASSWORD: "certificate-password",
      LIOS_UPDATE_URL: "https://updates.example.test/lios/",
    },
    cwd: "/repo/src",
    platform: "win32",
    existsSync: () => true,
    readFileSync: () => CURRENT_JOURNAL,
    execFile: (file) => {
      if (file === "python3") return "Python 3.12.6";
      throw new Error(`unexpected executable ${file}`);
    },
  });
  assert.equal(byId(results, "desktop_signing").pass, true);
  assert.equal(byId(results, "desktop_notarization").required, false);
  assert.deepEqual(results.filter((result) => result.required && !result.pass), []);
});

test("desktop mode rejects permissive legacy migration flags", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const results = collectPreflightChecks({
    mode: "desktop",
    env: {
      NODE_ENV: "production",
      LIMURIA_ALLOW_LEGACY_HMAC_LICENSE_LEASE: "true",
      LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER: "true",
      LIMURIA_LICENSE_SIGNING_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      LIMURIA_LICENSE_SIGNING_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
      LIOS_BETA_DATA_DIR: "beta-data",
    },
    cwd: "/repo/src",
    platform: "darwin",
    existsSync: () => true,
    readFileSync: () => CURRENT_JOURNAL,
    execFile: (file) => {
      if (file === "python3") return "Python 3.12.6";
      if (file === "security") return "1 valid identities found";
      throw new Error(`unexpected executable ${file}`);
    },
  });


  assert.equal(byId(results, "legacy_hmac_disabled").pass, false);
  assert.equal(byId(results, "legacy_device_header_disabled").pass, false);
  assert.match(formatPreflightResult(byId(results, "legacy_hmac_disabled")), /^BLOCKED /);
});
test("preflight blocks legacy default administrator switches", () => {
  const results = collectPreflightChecks({
    mode: "ci",
    env: { LIMURIA_BOOTSTRAP_USE_STANDARD_ADMIN: "true" },
    cwd: "/repo/src",
    platform: "linux",
    existsSync: () => true,
    readFileSync: () => CURRENT_JOURNAL,
    execFile: (file) => {
      if (file === "python3") return "Python 3.12.6";
      throw new Error(`unexpected executable ${file}`);
    },
  });

  const defaultAdmin = byId(results, "legacy_default_admin_removed");
  assert.equal(defaultAdmin.pass, false);
  assert.equal(defaultAdmin.required, true);
  assert.match(formatPreflightResult(defaultAdmin), /^BLOCKED /);
});

test("migration preflight derives the latest SQL filename from the journal", () => {
  const checkedPaths: string[] = [];
  const results = collectPreflightChecks({
    mode: "ci",
    env: {},
    cwd: "/repo/src",
    platform: "linux",
    existsSync: (target) => {
      checkedPaths.push(String(target));
      return String(target).endsWith("0042_current_schema.sql");
    },
    readFileSync: () => JSON.stringify({
      entries: [
        { idx: 41, tag: "0041_user_persona_preferences" },
        { idx: 42, tag: "0042_current_schema" },
      ],
    }),
    execFile: (file) => {
      if (file === "python3") return "Python 3.12.6";
      throw new Error(`unexpected executable ${file}`);
    },
  });

  assert.equal(byId(results, "source_migration").pass, true);
  assert.ok(checkedPaths.some((target) => target.endsWith("0042_current_schema.sql")));
  assert.ok(!checkedPaths.some((target) => target.endsWith("0033_organization_credentials.sql")));
});

test("packaged migration preflight blocks a resource tree missing the journal latest migration", () => {
  const results = collectPreflightChecks({
    mode: "desktop",
    env: {
      NODE_ENV: "production",
      ELECTRON_RESOURCES_PATH: "/packaged/Resources",
    },
    cwd: "/repo/src",
    platform: "win32",
    existsSync: (target) => !String(target).includes("/packaged/Resources/migrations/"),
    readFileSync: () => CURRENT_JOURNAL,
    execFile: (file) => {
      if (file === "python3") return "Python 3.12.6";
      throw new Error(`unexpected executable ${file}`);
    },
  });

  const packaged = byId(results, "packaged_migration");
  assert.equal(packaged.pass, false);
  assert.equal(packaged.required, true);
  assert.match(packaged.detail, /0041_user_persona_preferences.*missing/i);
});
