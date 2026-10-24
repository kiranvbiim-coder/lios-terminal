#!/usr/bin/env node
/**
 * Real GM/P10 isolated numerical acceptance for a configured *local* pinned
 * Docker/Podman runtime. This never executes host Python, installs dependencies,
 * downloads data, or calls an AI provider. The same canonical call path is used
 * by production strict Python calculations.
 *
 * From src/: npm run acceptance:sp01-python-strict
 * Requires a qualified local engine target/image and associated policy env.
 * Failure is a truthful nonzero exit; no simulation or automatic downgrade.
 *
 * This is a source-checkout strict-runtime test, NOT installed Electron/SP/P14
 * evidence on its own. The installed journey still requires separate proof.
 */
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { callIsolatedPythonService, IsolatedPythonInputError } from '../server/isolatedPythonService.ts';
import { resolveSandboxRuntimeProfile } from '../server/exec/sandbox-runtime-profile.ts';
import { REVERSE_ROUTE, REVERSE_BODY, verifyReverseDcfResult } from './sp01_strict_python_valuation_contract.mjs';

const serviceDir = fileURLToPath(new URL('../python-service/', import.meta.url));
const TIMEOUT_MS = 60_000;

async function requireInputRejection(route, body, label) {
  try {
    await callIsolatedPythonService(route, body, { serviceDir, timeoutMs: TIMEOUT_MS });
  } catch (error) {
    if (error instanceof IsolatedPythonInputError) {
      console.log(`PASS ${label}: canonical isolated worker rejected invalid input`);
      return;
    }
    throw new Error(`${label}: worker did not return a valid governed input refusal.`, { cause: error });
  }
  throw new Error(`${label}: isolated worker accepted invalid input.`);
}

async function main() {
  // Requiring the real strict profile prevents a developer's legacy-host setup
  // from accidentally turning an absent sandbox into apparent acceptance.
  if (process.env.LIOS_EXECUTION_ISOLATION !== 'strict') {
    throw new Error('Acceptance requires LIOS_EXECUTION_ISOLATION=strict and a configured local pinned sandbox.');
  }
  const profile = resolveSandboxRuntimeProfile();
  if (!profile.backend || !profile.image || !profile.engine || !profile.engineTarget) {
    throw new Error('Strict local container backend is missing or not configured.');
  }

  const started = performance.now();
  const actual = await callIsolatedPythonService(REVERSE_ROUTE, REVERSE_BODY, {
    serviceDir, timeoutMs: TIMEOUT_MS,
  });
  verifyReverseDcfResult(actual);
  console.log('PASS strict.reverse_dcf: isolated worker reproduced independently verified numerical result');

  await requireInputRejection(
    REVERSE_ROUTE,
    { ...REVERSE_BODY, terminalGrowthPct: 11 },
    'strict.invalid_dcf_assumptions',
  );

  await requireInputRejection(
    '/not-a-registered-numerical-route',
    {},
    'strict.route_allowlist',
  );

  // A pre-cancelled request must not start a numerical container or disclose
  // caller-provided cancellation reasons.
  const controller = new AbortController();
  controller.abort('PRIVATE_PRE_CANCEL_REASON');
  let refused = false;
  try {
    await callIsolatedPythonService(REVERSE_ROUTE, REVERSE_BODY, {
      serviceDir, signal: controller.signal, timeoutMs: TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError' &&
      !error.message.includes('PRIVATE_PRE_CANCEL_REASON')) {
      refused = true;
    } else {
      throw error;
    }
  }
  if (!refused) throw new Error('Strict pre-cancelled numerical request was not rejected.');
  console.log('PASS strict.pre_cancel: cancellation refused without exposing caller reason');

  console.log(JSON.stringify({
    accepted: true,
    scope: 'real-local-strict-sandbox-source-checkout',
    engine: profile.engine,
    checks: ['reverse-dcf', 'bad-assumptions', 'route-allowlist', 'pre-cancel'],
    elapsedMs: Math.round(performance.now() - started),
    // No customer payload, local engine endpoint, credentials, or environment dump.
  }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Strict Python numerical acceptance failed.');
  process.exitCode = 1;
});
