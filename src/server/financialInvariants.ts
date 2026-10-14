export type InvariantSeverity = "warning" | "blocker";

export interface InvariantFinding {
  code: string;
  severity: InvariantSeverity;
  message: string;
  observed?: number;
  expectedMin?: number;
  expectedMax?: number;
  tolerance?: number;
}

export interface InvariantReport {
  pass: boolean;
  findings: InvariantFinding[];
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function report(findings: InvariantFinding[]): InvariantReport {
  return { pass: !findings.some((item) => item.severity === "blocker"), findings };
}

export interface EuropeanOptionQuote {
  spot: number;
  strike: number;
  timeYears: number;
  riskFreeRate: number;
  dividendYield?: number;
  callPrice?: number;
  putPrice?: number;
  tolerance?: number;
}

export function validateEuropeanOptionNoArbitrage(input: EuropeanOptionQuote): InvariantReport {
  const findings: InvariantFinding[] = [];
  const tolerance = Math.max(0, input.tolerance ?? 1e-8);
  const q = input.dividendYield ?? 0;

  if (![input.spot, input.strike, input.timeYears, input.riskFreeRate, q].every(finite)) {
    return report([{ code: "OPTION_NON_FINITE_INPUT", severity: "blocker", message: "Option inputs must be finite" }]);
  }
  if (input.spot <= 0 || input.strike <= 0 || input.timeYears < 0) {
    return report([{ code: "OPTION_INVALID_DOMAIN", severity: "blocker", message: "Spot/strike must be positive and time cannot be negative" }]);
  }

  const discountedSpot = input.spot * Math.exp(-q * input.timeYears);
  const discountedStrike = input.strike * Math.exp(-input.riskFreeRate * input.timeYears);
  const callMin = Math.max(0, discountedSpot - discountedStrike);
  const callMax = discountedSpot;
  const putMin = Math.max(0, discountedStrike - discountedSpot);
  const putMax = discountedStrike;

  if (input.callPrice !== undefined) {
    if (!finite(input.callPrice)) {
      findings.push({ code: "CALL_NON_FINITE", severity: "blocker", message: "Call price must be finite" });
    } else if (input.callPrice < callMin - tolerance || input.callPrice > callMax + tolerance) {
      findings.push({
        code: "CALL_ARBITRAGE_BOUND",
        severity: "blocker",
        message: "Call price violates European no-arbitrage bounds",
        observed: input.callPrice,
        expectedMin: callMin,
        expectedMax: callMax,
        tolerance,
      });
    }
  }

  if (input.putPrice !== undefined) {
    if (!finite(input.putPrice)) {
      findings.push({ code: "PUT_NON_FINITE", severity: "blocker", message: "Put price must be finite" });
    } else if (input.putPrice < putMin - tolerance || input.putPrice > putMax + tolerance) {
      findings.push({
        code: "PUT_ARBITRAGE_BOUND",
        severity: "blocker",
        message: "Put price violates European no-arbitrage bounds",
        observed: input.putPrice,
        expectedMin: putMin,
        expectedMax: putMax,
        tolerance,
      });
    }
  }

  if (input.callPrice !== undefined && input.putPrice !== undefined && finite(input.callPrice) && finite(input.putPrice)) {
    const parityResidual = input.callPrice - input.putPrice - (discountedSpot - discountedStrike);
    if (Math.abs(parityResidual) > tolerance) {
      findings.push({
        code: "PUT_CALL_PARITY",
        severity: "blocker",
        message: "Call and put prices violate European put-call parity",
        observed: parityResidual,
        expectedMin: -tolerance,
        expectedMax: tolerance,
        tolerance,
      });
    }
  }

  return report(findings);
}

export interface DiscountCurvePoint {
  timeYears: number;
  discountFactor: number;
}

export function validateDiscountCurve(
  points: DiscountCurvePoint[],
  options: { allowNegativeForwardRates?: boolean; maxAbsoluteForwardRate?: number; tolerance?: number } = {},
): InvariantReport {
  const findings: InvariantFinding[] = [];
  const tolerance = Math.max(0, options.tolerance ?? 1e-10);
  const maxForward = Math.max(0.01, options.maxAbsoluteForwardRate ?? 5);
  if (points.length === 0) {
    return report([{ code: "CURVE_EMPTY", severity: "blocker", message: "Discount curve must contain at least one point" }]);
  }

  let previousTime = 0;
  let previousDf = 1;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!finite(point.timeYears) || !finite(point.discountFactor)) {
      findings.push({ code: "CURVE_NON_FINITE", severity: "blocker", message: `Curve point ${index} contains a non-finite value` });
      continue;
    }
    if (point.timeYears <= previousTime) {
      findings.push({ code: "CURVE_TIME_ORDER", severity: "blocker", message: "Curve maturities must be strictly increasing", observed: point.timeYears });
    }
    if (point.discountFactor <= 0) {
      findings.push({ code: "CURVE_NON_POSITIVE_DF", severity: "blocker", message: "Discount factors must be strictly positive", observed: point.discountFactor });
    }

    if (point.timeYears > previousTime && point.discountFactor > 0 && previousDf > 0) {
      const dt = point.timeYears - previousTime;
      const forwardRate = -Math.log(point.discountFactor / previousDf) / dt;
      if (!finite(forwardRate) || Math.abs(forwardRate) > maxForward + tolerance) {
        findings.push({
          code: "CURVE_IMPLAUSIBLE_FORWARD",
          severity: "blocker",
          message: "Implied continuously compounded forward rate is outside configured bounds",
          observed: forwardRate,
          expectedMin: -maxForward,
          expectedMax: maxForward,
          tolerance,
        });
      } else if (!options.allowNegativeForwardRates && forwardRate < -tolerance) {
        findings.push({
          code: "CURVE_NEGATIVE_FORWARD",
          severity: "warning",
          message: "Curve implies a negative forward rate; allowed only as a reviewed market regime",
          observed: forwardRate,
        });
      }
    }

    previousTime = point.timeYears;
    previousDf = point.discountFactor;
  }

  return report(findings);
}

export function validateProbabilityVector(
  probabilities: number[],
  tolerance = 1e-10,
): InvariantReport {
  const findings: InvariantFinding[] = [];
  if (probabilities.length === 0) {
    return report([{ code: "PROBABILITY_EMPTY", severity: "blocker", message: "Probability vector cannot be empty" }]);
  }
  if (probabilities.some((value) => !finite(value))) {
    findings.push({ code: "PROBABILITY_NON_FINITE", severity: "blocker", message: "Probabilities must be finite" });
  }
  probabilities.forEach((value, index) => {
    if (finite(value) && (value < -tolerance || value > 1 + tolerance)) {
      findings.push({ code: "PROBABILITY_DOMAIN", severity: "blocker", message: `Probability ${index} is outside [0,1]`, observed: value });
    }
  });
  const sum = probabilities.reduce((acc, value) => acc + value, 0);
  if (finite(sum) && Math.abs(sum - 1) > tolerance) {
    findings.push({
      code: "PROBABILITY_SUM",
      severity: "blocker",
      message: "Probabilities must sum to one within tolerance",
      observed: sum,
      expectedMin: 1 - tolerance,
      expectedMax: 1 + tolerance,
      tolerance,
    });
  }
  return report(findings);
}

function jacobiEigenvalues(matrix: number[][], tolerance: number, maxIterations: number): number[] {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let p = 0;
    let q = 1;
    let max = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const candidate = Math.abs(a[i][j]);
        if (candidate > max) {
          max = candidate;
          p = i;
          q = j;
        }
      }
    }
    if (max <= tolerance) break;

    const theta = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const app = c * c * a[p][p] - 2 * s * c * a[p][q] + s * s * a[q][q];
    const aqq = s * s * a[p][p] + 2 * s * c * a[p][q] + c * c * a[q][q];

    for (let k = 0; k < n; k += 1) {
      if (k === p || k === q) continue;
      const akp = a[k][p];
      const akq = a[k][q];
      a[k][p] = a[p][k] = c * akp - s * akq;
      a[k][q] = a[q][k] = s * akp + c * akq;
    }
    a[p][p] = app;
    a[q][q] = aqq;
    a[p][q] = a[q][p] = 0;
  }
  return a.map((row, index) => row[index]);
}

export function validateCovarianceMatrix(
  covariance: number[][],
  options: { symmetryTolerance?: number; psdTolerance?: number } = {},
): InvariantReport {
  const findings: InvariantFinding[] = [];
  const symmetryTolerance = Math.max(0, options.symmetryTolerance ?? 1e-10);
  const psdTolerance = Math.max(0, options.psdTolerance ?? 1e-10);
  const n = covariance.length;
  if (n === 0 || covariance.some((row) => row.length !== n)) {
    return report([{ code: "COVARIANCE_SHAPE", severity: "blocker", message: "Covariance matrix must be non-empty and square" }]);
  }
  if (covariance.some((row) => row.some((value) => !finite(value)))) {
    return report([{ code: "COVARIANCE_NON_FINITE", severity: "blocker", message: "Covariance matrix must contain only finite values" }]);
  }

  const symmetric = covariance.map((row) => [...row]);
  for (let i = 0; i < n; i += 1) {
    if (covariance[i][i] < -psdTolerance) {
      findings.push({ code: "COVARIANCE_NEGATIVE_VARIANCE", severity: "blocker", message: `Variance at index ${i} is negative`, observed: covariance[i][i] });
    }
    for (let j = i + 1; j < n; j += 1) {
      const difference = Math.abs(covariance[i][j] - covariance[j][i]);
      if (difference > symmetryTolerance) {
        findings.push({ code: "COVARIANCE_ASYMMETRY", severity: "blocker", message: `Covariance matrix is not symmetric at (${i},${j})`, observed: difference, tolerance: symmetryTolerance });
      }
      const average = (covariance[i][j] + covariance[j][i]) / 2;
      symmetric[i][j] = average;
      symmetric[j][i] = average;
    }
  }

  if (!findings.some((item) => item.code === "COVARIANCE_ASYMMETRY" || item.code === "COVARIANCE_NEGATIVE_VARIANCE")) {
    const eigenvalues = jacobiEigenvalues(symmetric, 1e-14, Math.max(50, n * n * 25));
    const minimumEigenvalue = Math.min(...eigenvalues);
    if (minimumEigenvalue < -psdTolerance) {
      findings.push({
        code: "COVARIANCE_NOT_PSD",
        severity: "blocker",
        message: "Covariance matrix is not positive semidefinite",
        observed: minimumEigenvalue,
        expectedMin: -psdTolerance,
        tolerance: psdTolerance,
      });
    } else if (minimumEigenvalue < psdTolerance) {
      findings.push({
        code: "COVARIANCE_NEAR_SINGULAR",
        severity: "warning",
        message: "Covariance matrix is positive semidefinite but numerically near singular",
        observed: minimumEigenvalue,
        expectedMin: psdTolerance,
      });
    }
  }

  return report(findings);
}
