import fs from "node:fs";
import path from "node:path";

export class PrivateSecretFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateSecretFileError";
  }
}

/**
 * Reads one secret line (password, passphrase) from an operator-supplied file. The file must be absolute, not a
 * symlink, regular, owner-only, owned by the current user and at most 1024 bytes, so it can be a mounted secret
 * but never a world-readable file or an environment variable.
 */
export function readPrivateSecretFile(file: string, label: string): string {
  if (!path.isAbsolute(file)) throw new PrivateSecretFileError(`The ${label} path must be absolute.`);
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  } catch {
    throw new PrivateSecretFileError(`The ${label} cannot be opened as a regular file.`);
  }
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size < 1 || info.size > 1024
      || (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || (typeof process.getuid === "function" && info.uid !== process.getuid())))) {
      throw new PrivateSecretFileError(`The ${label} must be private (mode 0600 or 0400), regular, owned by the LiOS user and at most 1024 bytes.`);
    }
    const value = fs.readFileSync(fd, "utf8").replace(/\r?\n$/, "");
    if (!value || /[\r\n\0]/.test(value)) throw new PrivateSecretFileError(`The ${label} must contain exactly one line.`);
    return value;
  } finally {
    fs.closeSync(fd);
  }
}
