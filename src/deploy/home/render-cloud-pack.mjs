import path from "node:path";

const storageClasses = { aws: "gp3", azure: "managed-csi", gcp: "standard-rwo", kubernetes: null };

/** Renders resources only. Never creates cloud accounts, spends money or applies a cluster change. */
export function renderUserCloudPack({ target, image, namespace = "lios-home", storageClass, storage = "20Gi" }) {
  if (!Object.hasOwn(storageClasses, target)) throw new Error("Target must be aws, azure, gcp or kubernetes.");
  if (!/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(image ?? "")) throw new Error("An owner-built image pinned by sha256 digest is required.");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(namespace)) throw new Error("Namespace must be a Kubernetes DNS label.");
  const selectedStorage = storageClass ?? storageClasses[target];
  if (selectedStorage !== null && !/^[a-z0-9][a-z0-9.-]{0,252}$/.test(selectedStorage)) throw new Error("Storage class must be an installed Kubernetes class name.");
  if (!/^[1-9][0-9]{0,3}Gi$/.test(storage)) throw new Error("Persistent storage must be 1–9999Gi.");
  const labels = { "app.kubernetes.io/name": "lios-home", "app.kubernetes.io/managed-by": "user-owned-lios-pack" };
  const metadata = name => ({ name, namespace, labels });
  const env = Object.entries({ NODE_ENV: "production", HOST: "0.0.0.0", PORT: "10000", HOME: "/data/lios/.home", LIOS_DATA_ROOT: "/data/lios", LIOS_EXECUTION_ISOLATION: "strict", PYTHONDONTWRITEBYTECODE: "1", PYTHONPYCACHEPREFIX: "/tmp/pycache" }).map(([name, value]) => ({ name, value }));
  const httpGet = { path: "/health", port: "http" };
  return { apiVersion: "v1", kind: "List", items: [
    { apiVersion: "v1", kind: "Namespace", metadata: { name: namespace, labels: { ...labels, "pod-security.kubernetes.io/enforce": "restricted" } } },
    { apiVersion: "v1", kind: "ServiceAccount", metadata: metadata("lios-home"), automountServiceAccountToken: false },
    { apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: metadata("lios-home-data"), spec: { accessModes: ["ReadWriteOnce"], ...(selectedStorage ? { storageClassName: selectedStorage } : {}), resources: { requests: { storage } } } },
    { apiVersion: "apps/v1", kind: "Deployment", metadata: metadata("lios-home"), spec: {
      replicas: 1, strategy: { type: "Recreate" }, selector: { matchLabels: { "app.kubernetes.io/name": "lios-home" } },
      template: { metadata: { labels }, spec: {
        serviceAccountName: "lios-home", automountServiceAccountToken: false, terminationGracePeriodSeconds: 90,
        securityContext: { runAsNonRoot: true, runAsUser: 10001, runAsGroup: 10001, fsGroup: 10001, fsGroupChangePolicy: "OnRootMismatch", seccompProfile: { type: "RuntimeDefault" } },
        containers: [{ name: "home", image, imagePullPolicy: "IfNotPresent", ports: [{ name: "http", containerPort: 10000 }], env,
          securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } },
          resources: { requests: { cpu: "500m", memory: "2Gi" }, limits: { cpu: "2", memory: "4Gi" } },
          startupProbe: { httpGet, periodSeconds: 5, failureThreshold: 60 }, readinessProbe: { httpGet, periodSeconds: 10, failureThreshold: 3 }, livenessProbe: { httpGet, periodSeconds: 30, failureThreshold: 3 },
          volumeMounts: [{ name: "home", mountPath: "/data/lios" }, { name: "scratch", mountPath: "/tmp" }],
        }],
        volumes: [{ name: "home", persistentVolumeClaim: { claimName: "lios-home-data" } }, { name: "scratch", emptyDir: { medium: "Memory", sizeLimit: "512Mi" } }],
      } },
    } },
    { apiVersion: "v1", kind: "Service", metadata: metadata("lios-home"), spec: { type: "ClusterIP", selector: { "app.kubernetes.io/name": "lios-home" }, ports: [{ name: "http", port: 10000, targetPort: "http" }] } },
    { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", metadata: metadata("lios-home-ingress"), spec: {
      podSelector: { matchLabels: { "app.kubernetes.io/name": "lios-home" } }, policyTypes: ["Ingress"],
      ingress: [{ from: [{ podSelector: { matchLabels: { "lios-home-access": "approved" } } }], ports: [{ protocol: "TCP", port: 10000 }] }],
    } },
  ] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    const allowed = new Set(["target", "image", "namespace", "storage-class", "storage"]);
    const options = {};
    for (const argument of process.argv.slice(2)) {
      const match = /^--([a-z-]+)=(.+)$/.exec(argument);
      if (!match || !allowed.has(match[1]) || Object.hasOwn(options, match[1])) throw new Error("Use unique --target=, --image=, --namespace=, --storage-class= and --storage= arguments.");
      options[match[1]] = match[2];
    }
    const pack = renderUserCloudPack({ target: options.target, image: options.image, namespace: options.namespace, storageClass: options["storage-class"], storage: options.storage });
    process.stdout.write(JSON.stringify(pack, null, 2) + "\n");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Cloud pack rendering failed.");
    process.exitCode = 1;
  }
}
