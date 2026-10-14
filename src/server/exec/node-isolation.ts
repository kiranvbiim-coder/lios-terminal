const SAFE_ERROR_CODE = /^[A-Z0-9_]{1,80}$/;

export function nodePermissionModelFlag(
  nodeVersion: string = process.versions.node,
): "--permission" | "--experimental-permission" {
  const [major = 0, minor = 0] = nodeVersion.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    throw new Error("LiOS Node isolation requires Node.js 22.12.0 or newer.");
  }
  if ((major === 22 && minor < 13) || (major === 23 && minor < 5)) {
    return "--experimental-permission";
  }
  return "--permission";
}

/**
 * Locked preload that denies raw network APIs for Node Permission Model guests.
 *
 * Node's Permission Model intentionally does not govern network sockets. Keep
 * this primitive shared by P13 and GM-11c so there is one denial mechanism.
 */
export function nodeNetworkDenyImport(errorCode = "LIOS_EXEC_RAW_NETWORK_DENIED"): string {
  if (!SAFE_ERROR_CODE.test(errorCode)) {
    throw new Error("Node network-denial error code must be an uppercase identifier.");
  }
  const source = [
    'import http from "node:http";',
    'import https from "node:https";',
    'import http2 from "node:http2";',
    'import net from "node:net";',
    'import tls from "node:tls";',
    'import dgram from "node:dgram";',
    'import dns from "node:dns";',
    'import { syncBuiltinESMExports } from "node:module";',
    `const denied = () => { const error = new Error(${JSON.stringify(errorCode)}); error.code = "ERR_ACCESS_DENIED"; throw error; };`,
    'const lock = (target, key, replacement = denied) => { if (!(key in target)) return; Object.defineProperty(target, key, { value: replacement, writable: false, configurable: false }); };',
    'for (const [target, keys] of [[http,["get","request","createServer"]],[https,["get","request","createServer"]],[http2,["connect","createServer","createSecureServer"]],[net,["connect","createConnection","createServer","_createServerHandle"]],[tls,["connect","createServer"]],[dgram,["createSocket","_createSocketHandle"]],[dns,["lookup","lookupService","resolve","resolve4","resolve6","resolveAny","resolveCaa","resolveCname","resolveMx","resolveNaptr","resolveNs","resolvePtr","resolveSoa","resolveSrv","resolveTxt","reverse"]]]) for (const key of keys) lock(target, key);',
    'if (net.Socket?.prototype) lock(net.Socket.prototype, "connect");',
    'if (tls.TLSSocket?.prototype) lock(tls.TLSSocket.prototype, "connect");',
    'if (dns.Resolver?.prototype) for (const key of ["resolve","resolve4","resolve6","resolveAny","resolveCaa","resolveCname","resolveMx","resolveNaptr","resolveNs","resolvePtr","resolveSoa","resolveSrv","resolveTxt","reverse"]) lock(dns.Resolver.prototype, key);',
    'if (dns.promises) for (const key of ["lookup","lookupService","resolve","resolve4","resolve6","resolveAny","resolveCaa","resolveCname","resolveMx","resolveNaptr","resolveNs","resolvePtr","resolveSoa","resolveSrv","resolveTxt","reverse"]) lock(dns.promises, key);',
    'if (dns.promises?.Resolver?.prototype) for (const key of ["resolve","resolve4","resolve6","resolveAny","resolveCaa","resolveCname","resolveMx","resolveNaptr","resolveNs","resolvePtr","resolveSoa","resolveSrv","resolveTxt","reverse"]) lock(dns.promises.Resolver.prototype, key);',
    'const blockedBindings = new Set(["cares_wrap","tcp_wrap","udp_wrap","tls_wrap"]);',
    'if (typeof process.binding === "function") { const originalBinding = process.binding.bind(process); Object.defineProperty(process, "binding", { value: (name) => blockedBindings.has(String(name)) ? denied() : originalBinding(name), writable: false, configurable: false }); }',
    'syncBuiltinESMExports();',
    'Object.defineProperty(globalThis, "fetch", { value: async () => denied(), writable: false, configurable: false });',
    'if ("WebSocket" in globalThis) Object.defineProperty(globalThis, "WebSocket", { value: class { constructor() { denied(); } }, writable: false, configurable: false });',
    'if ("EventSource" in globalThis) Object.defineProperty(globalThis, "EventSource", { value: class { constructor() { denied(); } }, writable: false, configurable: false });',
  ].join("\n");
  return "data:text/javascript," + encodeURIComponent(source);
}
