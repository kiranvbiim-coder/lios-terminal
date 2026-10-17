import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { p6PersonalFinanceRequestSchema } from "@shared/p6FinanceContracts";
import { remoteFinanceReportSchema, remoteFinanceSourceSchema, type RemoteFinanceSource } from "@shared/remoteNode";
import { calculatePersonalFinanceSnapshot } from "./p6PersonalFinance";

export interface NodeLocalFinanceConfiguration { sourceId: string; profilePath: string; ownerApproved: true; dataRights: "user-owned-profile" }
const MAX_PROFILE_BYTES = 256 * 1024;

/** Reads only the locally configured source. Home never supplies a filename.
 * POSIX ownership/mode checks are mandatory; Windows ACL qualification is not
 * silently replaced by an unverified owner-only claim. */
export async function loadNodeLocalFinanceSource(configuration: NodeLocalFinanceConfiguration) {
  if (configuration.ownerApproved !== true || configuration.dataRights !== "user-owned-profile" || process.platform === "win32" || !process.getuid || !constants.O_NOFOLLOW) throw new Error("Node finance requires explicit local approval, user-owned profile rights and supported ownership checks.");
  remoteFinanceSourceSchema.shape.sourceId.parse(configuration.sourceId);
  const filename = configuration.profilePath;
  if (!path.isAbsolute(filename) || path.normalize(filename) !== filename) throw new Error("Node profile requires a canonical local absolute path.");
  let current = path.parse(filename).root;
  for (const part of filename.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Node profile paths cannot contain symbolic links.");
  }
  if (await realpath(filename) !== filename) throw new Error("Node profile path changed.");
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 || stat.nlink !== 1 || stat.size > MAX_PROFILE_BYTES) throw new Error("Node profile must be a bounded, owner-only, unlinked regular file.");
    const bytes = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    const after = await lstat(filename);
    if (bytesRead > MAX_PROFILE_BYTES || bytesRead !== stat.size || after.dev !== stat.dev || after.ino !== stat.ino || after.isSymbolicLink() || after.uid !== stat.uid || (after.mode & 0o077) !== 0 || after.nlink !== 1 || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || await realpath(filename) !== filename) throw new Error("Node profile changed during the bounded read.");
    const content = bytes.subarray(0, bytesRead);
    const profile = p6PersonalFinanceRequestSchema.parse(JSON.parse(content.toString("utf8")));
    if (profile.accounts.length > 256 || profile.transactions.length > 4096 || profile.debts.length > 64 || profile.goals.length > 64 || profile.retirementStress || profile.fxNormalization) throw new Error("Node finance profile exceeds the closed snapshot capability; FX providers and stress simulation are not admitted.");
    if (profile.accounts.some((account) => !/^[A-Z]{3}$/.test(account.currency))) throw new Error("Node finance requires explicit ISO-style reporting currencies.");
    const currencies = new Set([...profile.accounts, ...profile.debts, ...profile.goals].map(item => item.currency));
    if (currencies.size > 1 || [...currencies].some(currency => !/^[A-Z]{3}$/.test(currency))) throw new Error("Node finance snapshot requires one explicit currency; mixed units need a separately governed FX-normalized capability.");
    const accountIds = new Set(profile.accounts.map(account => account.id));
    if (accountIds.size !== profile.accounts.length || profile.transactions.some(transaction => !accountIds.has(transaction.accountId))) throw new Error("Node finance account identities must be unique and every transaction must belong to a supplied account.");
    const source = remoteFinanceSourceSchema.parse({ sourceId: configuration.sourceId, inputHash: createHash("sha256").update(content).digest("hex") });
    if (profile.asOf > new Date().toISOString().slice(0, 10)) throw new Error("Node finance does not admit a future asOf date.");
    return { source, profile };
  } finally { await file.close(); }
}

export async function executeNodeLocalFinanceSnapshot(configuration: NodeLocalFinanceConfiguration, expected: RemoteFinanceSource) {
  const { source, profile } = await loadNodeLocalFinanceSource(configuration);
  if (source.sourceId !== expected.sourceId || source.inputHash !== expected.inputHash) throw new Error("Node finance source no longer matches the exact owner-requested hash.");
  // Canonical P6 math only. Account/transaction/debt/goal identities, raw
  // profiles and local filesystem paths never leave this node.
  const snapshot = calculatePersonalFinanceSnapshot(profile);
  const currencies = new Set([...profile.accounts, ...profile.debts, ...profile.goals].map(item => item.currency));
  return remoteFinanceReportSchema.parse({
    source, engineId: snapshot.engineId, engineVersion: snapshot.engineVersion, deterministic: snapshot.deterministic, engineInputHash: snapshot.inputHash,
    asOf: snapshot.asOf, currency: currencies.size === 1 ? [...currencies][0] : null,
    netWorth: snapshot.netWorth, assets: snapshot.assets, liabilities: snapshot.liabilities,
    trailingMonthlyIncome: snapshot.trailingMonthlyIncome, trailingMonthlyExpenses: snapshot.trailingMonthlyExpenses, trailingMonthlyCashFlow: snapshot.trailingMonthlyCashFlow, savingsRate: snapshot.savingsRate,
    warnings: snapshot.warnings, execution: "canonical-p6-node-local-read-no-subprocess",
  });
}
