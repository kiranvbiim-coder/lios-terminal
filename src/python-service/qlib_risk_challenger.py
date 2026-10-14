"""Bounded Qlib risk-analysis formula challenger owned by LiOS P11.

Source: microsoft/qlib, qlib/contrib/evaluate.py:risk_analysis,
commit be725493eb1a6bbb42bf11b37aa7669f59610ff1 (MIT).
Copyright (c) Microsoft Corporation. Adapted for bounded/finite input,
explicit calendar scaling, reproducible receipts and fail-closed outputs.

This is not the Qlib Python distribution, a data provider, a model, a
historical backtest, a trading system, or an independently validated risk
forecast. The calling LiOS tool owns Project grants and source provenance.
"""
from __future__ import annotations

import math
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


SOURCE_COMMIT = "be725493eb1a6bbb42bf11b37aa7669f59610ff1"
METHOD = "qlib_risk_analysis_mit_adaptation_v1"


class QlibRiskChallengerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    returns: list[float] = Field(min_length=2, max_length=512)
    annualizationSessions: int = Field(strict=True, ge=1, le=365)
    mode: Literal["sum", "product"]

    @field_validator("returns", mode="before")
    @classmethod
    def validate_return_vector(cls, value: object) -> object:
        if not isinstance(value, list) or not 2 <= len(value) <= 512:
            raise ValueError("Expected 2 to 512 period returns.")
        # Pydantic's ordinary float coercion accepts numeric strings and bools.
        # Neither is allowed to masquerade as a verified measured series.
        if any(type(item) not in (int, float) for item in value):
            raise ValueError("Returns must be explicit numerical observations.")
        if any(not -1 < item <= 10 for item in value) or any(not math.isfinite(float(item)) for item in value):
            raise ValueError("Each return must be finite, > -100% and <= +1000%.")
        return value


class QlibRiskChallengerResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    method: Literal["qlib_risk_analysis_mit_adaptation_v1"]
    inputTruth: Literal["unknown"]
    runtime: Literal["liOS_adapted_formula"]
    accumulation: Literal["sum", "product"]
    sampleCount: int
    annualizationSessions: int
    mean: float
    std: float = Field(ge=0)
    annualizedReturn: float
    informationRatio: Optional[float]
    maxDrawdown: float = Field(le=0)
    caveats: list[str]


def calculate_qlib_risk_challenger(req: QlibRiskChallengerRequest) -> QlibRiskChallengerResponse:
    """Calculate only MIT Qlib-adapted risk formulas; no provider or side effects."""
    values = req.returns
    n = len(values)
    sessions = req.annualizationSessions
    mode = req.mode
    mean_arithmetic = math.fsum(values) / n

    peak = -math.inf
    max_drawdown = 0.0
    if mode == "sum":
        mean = mean_arithmetic
        volatility_input = values
        annualized = mean * sessions
        cumulative = 0.0
        for value in values:
            cumulative += value
            peak = max(peak, cumulative)
            max_drawdown = min(max_drawdown, cumulative - peak)
    else:
        cumulative = 1.0
        for value in values:
            cumulative *= 1 + value
            if not math.isfinite(cumulative) or cumulative <= 0:
                raise ValueError("Compounded series overflow/underflow: result unavailable.")
            peak = max(peak, cumulative)
            max_drawdown = min(max_drawdown, cumulative / peak - 1)
        mean = cumulative ** (1.0 / n) - 1
        annualized = cumulative ** (sessions / n) - 1
        volatility_input = [math.log1p(value) for value in values]

    volatility_mean = math.fsum(volatility_input) / n
    # Historical constant return series have exactly zero variance; floating
    # accumulation artifacts may otherwise fabricate huge information ratios.
    constant_series = all(value == volatility_input[0] for value in volatility_input)
    centered_squared = math.fsum((value - volatility_mean) ** 2 for value in volatility_input)
    std = 0.0 if constant_series else math.sqrt(centered_squared / (n - 1))  # pandas ddof=1
    ratio = None if std == 0 else (mean / std) * math.sqrt(sessions)

    for value in (mean, std, annualized, max_drawdown, ratio if ratio is not None else 0):
        if not math.isfinite(value):
            raise ValueError("Non-finite Qlib challenger output is unavailable.")

    # JSON-safe and reproducible; negative zero is not useful risk evidence.
    def clean(value: float) -> float:
        return 0.0 if value == 0 else value

    return QlibRiskChallengerResponse(
        method=METHOD,
        inputTruth="unknown",
        runtime="liOS_adapted_formula",
        accumulation=mode,
        sampleCount=n,
        annualizationSessions=sessions,
        mean=clean(mean),
        std=clean(std),
        annualizedReturn=clean(annualized),
        informationRatio=None if ratio is None else clean(ratio),
        maxDrawdown=clean(max_drawdown),
        caveats=[
            "Caller-submitted returns have no verified provider, user, as-of or entitlement provenance.",
            "Sum accumulation is arithmetic; product accumulation is compounded.",
            "Information ratio requires precomputed active returns to be benchmark-relative.",
            *(
                ["Zero sample volatility means information ratio is undefined, not infinite."]
                if ratio is None else []
            ),
            "P11 formula challenger only: no Qlib distribution, model training, prices or trades.",
        ],
    )
