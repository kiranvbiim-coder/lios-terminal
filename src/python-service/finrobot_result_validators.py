"""Bounded FinRobot V2 result-contract validators for LiOS.

Adapted from AI4Finance-Foundation/FinRobot
`finrobot_desktop/finrobot/engine/pipelines/validators.py` at
2717499b8e30f242640af08c4ad9afd1113c2d45 (Apache-2.0).

This module is deliberately zero-I/O and stdlib-only. It validates whether a
result is structurally complete enough to consume; it does not establish source
truth, entitlement, numerical authority, Artifact publication permission, or a
pipeline/runtime success state. P7/P4/P11/GM remain canonical LiOS authorities.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Iterable


SOURCE_REPOSITORY = "AI4Finance-Foundation/FinRobot"
SOURCE_COMMIT = "2717499b8e30f242640af08c4ad9afd1113c2d45"
SOURCE_PATH = "finrobot_desktop/finrobot/engine/pipelines/validators.py"
METHOD = "finrobot_v2_result_contract_apache2_adaptation_v1"

_REPORT_MIN_CHARS = 200
_REPORT_SOFT_TARGET_CHARS = 1200


@dataclass(frozen=True)
class ValidationResult:
    passed: bool
    error: str | None = None
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class FinancialSnapshot:
    revenue: float
    market_cap: float
    ebitda: float | None = None
    pe_ratio: float | None = None


@dataclass(frozen=True)
class TechnicalStatus:
    monte_carlo_available: bool = False
    sniper_available: bool = False
    historical_bands_available: bool = False
    dcf_unavailable_degraded: bool = False
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class OwnershipGovernanceStatus:
    insider_transactions: int = 0
    institutional_holdings: int = 0
    has_proxy_compensation: bool = False
    schedule13_alerts: int = 0
    degraded_sections: tuple[str, ...] = ()


_NON_TICKER_ACRONYMS = frozenset(
    {
        "WACC",
        "DCF",
        "EBITDA",
        "GAAP",
        "IFRS",
        "FCF",
        "ROIC",
        "ROE",
        "ROA",
        "EPS",
        "YOY",
        "QOQ",
        "CAGR",
        "IPO",
        "LBO",
        "SEC",
        "GDP",
        "CPI",
        "FED",
        "NYSE",
        "ETF",
        "CEO",
        "CFO",
        "COO",
        "BUY",
        "SELL",
        "HOLD",
        "NOTE",
        "USD",
        "EUR",
        "GBP",
        "JPY",
        "CNY",
    }
)
_TICKER_REGEX = re.compile(r"\b([A-Z]{2,5})\b")


def _pass(*warnings: str) -> ValidationResult:
    return ValidationResult(passed=True, warnings=tuple(w for w in warnings if w))


def _fail(error: str) -> ValidationResult:
    return ValidationResult(passed=False, error=error)


def _extract_ticker_candidates(output: str) -> set[str]:
    return set(_TICKER_REGEX.findall(output)) - _NON_TICKER_ACRONYMS


def validate_is_non_empty(output: str) -> ValidationResult:
    if output and output.strip():
        return _pass()
    return _fail("Output is empty or whitespace")


def validate_has_fields(output: str, fields: list[str]) -> ValidationResult:
    normalized = output.lower()
    missing = [field for field in fields if field.replace("_", " ").lower() not in normalized]
    if missing:
        return _fail(f"Output missing required fields: {', '.join(missing)}")
    return _pass()


def validate_has_peers(output: str, min_peers: int = 3) -> ValidationResult:
    if min_peers < 1:
        return _fail("min_peers must be at least 1")
    tickers = _extract_ticker_candidates(output)
    if len(tickers) >= min_peers:
        return _pass()
    return _fail(f"Expected at least {min_peers} peer tickers, found {len(tickers)}: {sorted(tickers)}")


def validate_has_thesis(output: str) -> ValidationResult:
    lower = output.lower()
    indicators = (
        any(word in lower for word in ("buy", "hold", "sell", "overweight", "underweight", "outperform")),
        any(word in lower for word in ("catalyst", "upside", "driver", "tailwind")),
        any(word in lower for word in ("risk", "downside", "headwind", "threat")),
        any(word in lower for word in ("price target", "target price", "implied value")),
    )
    found = sum(indicators)
    if found >= 2:
        return _pass()
    return _fail(f"Expected at least 2 thesis indicators, found {found}")


def validate_report_format(output: str) -> ValidationResult:
    """Validate report assembly shape without claiming evidence truth.

    Preserves FinRobot's language-agnostic header/character strategy. Numeric
    presence is only a structural signal: it does not prove that a number is
    observed, cited, entitled, current, or correctly calculated.
    """
    text = output.strip() if output else ""
    if len(text) < _REPORT_MIN_CHARS:
        return _fail(
            f"Report too short to be a valid assembly: {len(text)} chars (min {_REPORT_MIN_CHARS})"
        )

    headers = re.findall(r"^#{1,3}\s+\S", output, re.MULTILINE)
    if len(headers) < 3:
        return _fail(f"Expected at least 3 section headers, found {len(headers)}")

    if not re.search(r"\d", output):
        return _fail("Report contains no numeric data")

    warnings = [
        "Numeric presence is a structural completeness signal only, not evidence or source verification."
    ]
    if len(text) < _REPORT_SOFT_TARGET_CHARS:
        warnings.append(
            f"Report is structurally valid but thin ({len(text)} chars < {_REPORT_SOFT_TARGET_CHARS} soft target); inspect upstream content rather than treating this as formatter success."
        )
    return _pass(*warnings)


def validate_has_comps_table(output: str) -> ValidationResult:
    tickers = _extract_ticker_candidates(output)
    if len(tickers) < 3:
        return _fail(f"Expected at least 3 company tickers, found {len(tickers)}: {sorted(tickers)}")

    lower = output.lower()
    multiples_found = sum(
        1 for keyword in ("ev/ebitda", "p/e", "ev/revenue", "multiple") if keyword in lower
    )
    if multiples_found < 2:
        return _fail(f"Expected at least 2 multiples keywords, found {multiples_found}")
    if not any(keyword in lower for keyword in ("median", "mean", "average")):
        return _fail("Missing statistical terms (median/mean/average)")
    return _pass("Comps structure validation does not verify peer identity, point-in-time inputs, or multiple provenance.")


def validate_dcf_output(output: str) -> ValidationResult:
    lower = output.lower()
    indicators = (
        any(word in lower for word in ("wacc", "discount rate", "cost of capital")),
        any(word in lower for word in ("terminal value", "terminal growth")),
        any(word in lower for word in ("free cash flow", "fcf")),
        any(word in lower for word in ("sensitivity", "scenario")),
        any(
            word in lower
            for word in (
                "implied price",
                "implied value",
                "valuation range",
                "fair value",
                "price target",
            )
        ),
    )
    found = sum(indicators)
    if found >= 3:
        return _pass("DCF text completeness does not validate P11 assumptions, formulas, or outputs.")
    return _fail(f"Expected at least 3 DCF components, found {found}")


def _finite(name: str, value: float | None) -> str | None:
    if value is None:
        return None
    if type(value) not in (int, float) or not math.isfinite(float(value)):
        return f"{name} must be a finite explicit number when present"
    return None


def validate_financial_snapshot(
    data: FinancialSnapshot,
    ebitda_margin_range: tuple[float, float] = (-5.0, 0.9),
) -> ValidationResult:
    """Defense-in-depth financial input sanity, never a P11 valuation verdict."""
    for name, value in (
        ("revenue", data.revenue),
        ("market_cap", data.market_cap),
        ("ebitda", data.ebitda),
        ("pe_ratio", data.pe_ratio),
    ):
        problem = _finite(name, value)
        if problem:
            return _fail(problem)

    margin_min, margin_max = ebitda_margin_range
    if not (math.isfinite(margin_min) and math.isfinite(margin_max) and margin_min <= margin_max):
        return _fail("EBITDA margin range must be finite and ordered")
    if data.revenue <= 0:
        return _fail("Revenue must be positive")
    if data.market_cap <= 0:
        return _fail("Market cap must be positive")
    if data.ebitda is not None:
        margin = data.ebitda / data.revenue
        if not margin_min <= margin <= margin_max:
            return _fail(
                f"EBITDA margin {margin:.1%} out of range ({margin_min:.0%} to {margin_max:.0%})"
            )
    if data.pe_ratio is not None and data.pe_ratio <= 0:
        return _fail("PE ratio must be positive if set")
    return _pass("Financial sanity bands are challenger checks, not authoritative P11 valuation validation.")


def validate_technical_status(status: TechnicalStatus) -> ValidationResult:
    if status.dcf_unavailable_degraded:
        warnings = status.warnings or ("Technical overlays unavailable because DCF input honestly degraded.",)
        return _pass(*warnings)
    if status.monte_carlo_available or status.sniper_available or status.historical_bands_available:
        return _pass(*status.warnings)
    joined = "; ".join(status.warnings) or "no diagnostics"
    return _fail(f"all technical-analysis branches failed: {joined}")


def validate_ownership_governance_status(status: OwnershipGovernanceStatus) -> ValidationResult:
    counts: Iterable[int] = (
        status.insider_transactions,
        status.institutional_holdings,
        status.schedule13_alerts,
    )
    if any(type(value) is not int or value < 0 for value in counts):
        return _fail("Ownership/governance observation counts must be non-negative integers")

    populated = (
        status.insider_transactions > 0
        or status.institutional_holdings > 0
        or status.has_proxy_compensation
        or status.schedule13_alerts > 0
    )
    if populated:
        return _pass()
    if status.degraded_sections:
        return _pass(
            "Ownership/governance output contains explicit degraded sections; missing data is not treated as a successful observation."
        )
    return _fail("ownership_governance_analysis produced no data and no degraded sections")
