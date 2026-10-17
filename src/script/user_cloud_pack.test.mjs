import assert from "node:assert/strict";
import test from "node:test";
import { renderUserCloudPack } from "../deploy/home/render-cloud-pack.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dataRoot from "../dataRootCore.cjs";

const image = `owner.example/lios-home@sha256:${"a".repeat(64)}`;
test("user cloud packs retain one canonical writer and no public or privileged execution authority", () => {
  for (const target of ["aws", "azure", "gcp", "kubernetes"]) {
    const pack = renderUserCloudPack({ target, image, namespace: "owned-home" });
    const deployment = pack.items.find(item => item.kind === "Deployment");
    assert.equal(deployment.spec.replicas, 1, "embedded Home database is not a multi-writer replica set");
    assert.equal(deployment.spec.strategy.type, "Recreate", "updates must not overlap writers on the same Home volume");
    const pod = deployment.spec.template.spec;
    assert.equal(pod.automountServiceAccountToken, false);
    assert.equal(pod.securityContext.runAsNonRoot, true);
    const home = pod.containers[0];
    assert.equal(home.securityContext.allowPrivilegeEscalation, false);
    assert.equal(home.securityContext.readOnlyRootFilesystem, true);
    assert.deepEqual(home.securityContext.capabilities.drop, ["ALL"]);
    assert.equal(home.env.find(item => item.name === "LIOS_EXECUTION_ISOLATION").value, "strict");
    assert.equal(pod.volumes.some(volume => volume.hostPath), false, "pack cannot expose a host execution socket/path");
    assert.equal(pack.items.find(item => item.kind === "Service").spec.type, "ClusterIP", "deploying must not create a public paid load balancer");
    assert.equal(pack.items.some(item => ["Ingress", "RoleBinding", "ClusterRoleBinding", "Secret"].includes(item.kind)), false);
    const claims = pack.items.filter(item => item.kind === "PersistentVolumeClaim");
    assert.equal(claims.length, 1);
    assert.deepEqual(claims[0].spec.accessModes, ["ReadWriteOnce"]);
    assert.equal(home.env.find(item => item.name === "HOME").value, "/data/lios/.home", "root ledger and owner control files must be writable within the persistent volume");
  }
});
test("cloud profile storage binds installed CSI classes while generic Kubernetes preserves its user default", () => {
  const storageClass = target => renderUserCloudPack({ target, image }).items.find(item => item.kind === "PersistentVolumeClaim").spec.storageClassName;
  assert.equal(storageClass("aws"), "gp3");
  assert.equal(storageClass("azure"), "managed-csi");
  assert.equal(storageClass("gcp"), "standard-rwo");
  assert.equal(storageClass("kubernetes"), undefined);
  const claim = renderUserCloudPack({ target: "aws", image, storageClass: "owner-encrypted", storage: "120Gi" }).items.find(item => item.kind === "PersistentVolumeClaim");
  assert.equal(claim.spec.storageClassName, "owner-encrypted");
  assert.equal(claim.spec.resources.requests.storage, "120Gi");
});
test("unsafe cloud pack input cannot introduce mutable code, secret-bearing values or unbounded storage", () => {
  for (const patch of [
    { target: "vendor-cloud" }, { image: "owner/lios-home:latest" }, { image: "https://user:secret@host/image" },
    { namespace: "Bad Namespace" }, { storageClass: "../host" }, { storage: "0Gi" }, { storage: "10000Gi" }, { storage: "1Ti;execute" },
  ]) assert.throws(() => renderUserCloudPack({ target: "kubernetes", image, ...patch }));
});

test("headless root identity and known-root ledger survive restart entirely within the persistent mount", () => {
  const volume = fs.mkdtempSync(path.join(os.tmpdir(), "lios-cloud-volume-"));
  try {
    const env = { HOME: path.join(volume, ".home"), LIOS_DATA_ROOT: volume, NODE_ENV: "production" };
    const initial = dataRoot.prepareDataRoot({ env });
    assert.equal(initial.firstRun, true);
    assert.ok(fs.existsSync(path.join(volume, ".home", ".limuria-terminal", "known-roots.json")));
    const reopened = dataRoot.prepareDataRoot({ env });
    assert.equal(reopened.rootId, initial.rootId, "restart preserves root identity rather than creating a new Home");
    assert.equal(reopened.root, initial.root);
  } finally { fs.rmSync(volume, { recursive: true, force: true }); }
});
