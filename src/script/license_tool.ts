import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LICENSE_TRUST_ANCHORS } from "@shared/licenseTrust";
import { createSignedAsymmetricOfflineLicenseLease, licenseKeyId } from "../server/licenseLease";
import { prepareDataRoot } from "../server/dataRoot";
import { importLicenseFile, licenseStatus, parseLicenseFile, serializeLicenseFile } from "../server/licenseFile";

const USAGE = `Customer:
  npm run license:status                       show this install's device hash and licence state
  npm run license:import -- <file.lioslicense> verify and install a licence
Vendor (needs the private signing key, kept outside the repository):
  npm run license:keygen -- <new-directory>    create an Ed25519 signing pair (pin the public key in shared/licenseTrust.ts)
  npm run license:issue  -- --key-file <private.pem> --org <id> --license <id> --days <n> --out <file>
        [--plan <code>] [--seats <n>] [--device-hash <hex>] (--unrestricted | --features a,b,c)
  npm run license:inspect -- <file>            print a licence's signed contents`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (command === "status" || command === "import") prepareDataRoot({ localDatabase: true });
  if (command === "status") {
    console.log(JSON.stringify(licenseStatus(), null, 2));
  } else if (command === "import" && args[0]) {
    console.log(JSON.stringify(importLicenseFile(fs.readFileSync(path.resolve(args[0]), "utf8")), null, 2));
  } else if (command === "inspect" && args[0]) {
    console.log(JSON.stringify(parseLicenseFile(fs.readFileSync(path.resolve(args[0]), "utf8")).payload, null, 2));
  } else if (command === "keygen" && args[0]) {
    const dir = path.resolve(args[0]);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    fs.writeFileSync(path.join(dir, "license-signing-private.pem"), privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
    fs.writeFileSync(path.join(dir, "license-signing-public.pem"), publicPem, { mode: 0o644, flag: "wx" });
    console.log(`Key id ${licenseKeyId(publicPem)}. Add it to shared/licenseTrust.ts:\n${JSON.stringify(publicPem)}`);
  } else if (command === "issue") {
    const keyFile = option(args, "--key-file");
    const out = option(args, "--out");
    const days = Number(option(args, "--days"));
    const organizationId = Number(option(args, "--org"));
    const licenseId = Number(option(args, "--license"));
    if (!keyFile || !out || !Number.isInteger(days) || days < 1 || days > 3650 || !Number.isInteger(organizationId) || !Number.isInteger(licenseId)
      || (!args.includes("--unrestricted") && !option(args, "--features"))) {
      console.error(USAGE);
      process.exitCode = 2;
      return;
    }
    const privateKey = fs.readFileSync(path.resolve(keyFile), "utf8");
    const publicPem = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
    const keyId = licenseKeyId(publicPem);
    if (LICENSE_TRUST_ANCHORS[keyId] !== publicPem) throw new Error(`Key ${keyId} is not pinned in shared/licenseTrust.ts; installs would reject this licence.`);
    const now = new Date();
    const seats = option(args, "--seats");
    const device = option(args, "--device-hash");
    const plan = option(args, "--plan");
    const lease = createSignedAsymmetricOfflineLicenseLease({
      organizationId,
      licenseId,
      status: "active",
      seatsPurchased: seats ? Number(seats) : 1,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
      keyId,
      ...(device ? { deviceFingerprintHash: device } : {}),
      ...(plan ? { planCode: plan } : {}),
      entitlementMode: args.includes("--unrestricted") ? "unrestricted" : "allowlist",
      ...(args.includes("--unrestricted") ? {} : { featureKeys: (option(args, "--features") as string).split(",").map((item) => item.trim()).filter(Boolean).sort() }),
    }, privateKey);
    fs.writeFileSync(path.resolve(out), serializeLicenseFile(lease), { mode: 0o644, flag: "wx" });
    console.log(`Licence written to ${path.resolve(out)} (key ${keyId}, ${device ? "bound to one install" : "not device-bound"}, expires ${lease.payload.expiresAt}).`);
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
