import test from "node:test";
import assert from "node:assert/strict";
import { calculatePersonalFinanceSnapshot } from "./p6PersonalFinance";
import { p6PersonalFinanceRequestSchema } from "@shared/p6FinanceContracts";

const retirement = {
  currentAge: 60, retirementAge: 60, currentPortfolio: 100,
  monthlyContribution: 0, annualReturnAssumption: 0,
  annualInflationAssumption: 0, annualRetirementSpendingToday: 10,
  withdrawalRate: 0.1,
};
const base = {
  schemaVersion: "1" as const, asOf: "2026-10-11",
  accounts: [], transactions: [], debts: [], goals: [],
  retirement,
};
const stress = { annualReturnVolatility: 0, paths: 100, yearsInRetirement: 5, seed: 42 };

test("P6 existing snapshot remains backward compatible without opting into stress", () => {
  const out = calculatePersonalFinanceSnapshot(base);
  assert.equal(Object.hasOwn(out, "retirementStress"), false);
  assert.equal(out.retirement?.years, 0);
  assert.equal(out.engineVersion, "1.1.0");
});

test("P6 canonical personal finance calculation opts in to reproducible stress", () => {
  const first = calculatePersonalFinanceSnapshot({ ...base, retirementStress: stress });
  const second = calculatePersonalFinanceSnapshot({ ...base, retirementStress: stress });
  assert.equal(first.retirementStress?.survivalProbability, 1);
  assert.equal(first.retirementStress?.terminalPortfolioMedian, 50);
  assert.equal(first.retirementStress?.outputHash, second.retirementStress?.outputHash);
  assert.match(first.retirementStress?.outputHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(first.retirementStress?.assumptions.seed, 42);
  assert.notEqual(first.inputHash, calculatePersonalFinanceSnapshot(base).inputHash);
});

test("P6 rejects stress-only requests without retirement facts", () => {
  assert.throws(
    () => calculatePersonalFinanceSnapshot({ ...base, retirement: null, retirementStress: stress }),
    /retirementStress requires explicit retirement/i,
  );
});

test("P6 shared request schema rejects accidental unbounded or inferred stress parameters", () => {
  assert.equal(p6PersonalFinanceRequestSchema.safeParse({ ...base, retirementStress: stress }).success, true);
  for (const invalid of [
    { ...stress, paths: 50000 },
    { ...stress, annualReturnVolatility: Number.POSITIVE_INFINITY },
    { ...stress, yearsInRetirement: -1 },
    { paths: 200, seed: 1, yearsInRetirement: 20 },
    { ...stress, unexpectedPermission: "bypass" },
  ]) {
    assert.equal(p6PersonalFinanceRequestSchema.safeParse({ ...base, retirementStress: invalid }).success, false);
  }
});
