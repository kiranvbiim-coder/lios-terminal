export declare const QLIB_RISK_CHALLENGER_SOURCE: Readonly<{
  repository: "microsoft/qlib";
  commit: string;
  originalPath: "qlib/contrib/evaluate.py";
  originalFunction: "risk_analysis";
  license: "MIT";
  implementation: "adapted_formula_not_qlib_runtime";
}>;
export interface QlibChallengerRequest {
  returns: number[];
  annualizationSessions: number;
  mode: "sum" | "product";
}
export interface QlibChallengerOutput {
  method: "qlib_risk_analysis_mit_adaptation_v1";
  inputTruth: "unknown";
  runtime: "liOS_adapted_formula";
  accumulation: "sum" | "product";
  sampleCount: number;
  annualizationSessions: number;
  mean: number;
  std: number;
  annualizedReturn: number;
  informationRatio: number | null;
  maxDrawdown: number;
  caveats: string[];
}
export declare function evaluateQlibRiskChallenger(input: QlibChallengerRequest): QlibChallengerOutput;
