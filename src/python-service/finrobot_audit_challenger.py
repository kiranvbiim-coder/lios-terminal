"""LiOS P11 adaptation of FinRobot V2 deterministic financial-audit operators.

Upstream: AI4Finance-Foundation/FinRobot
Commit: 2717499b8e30f242640af08c4ad9afd1113c2d45
Source package: finrobot_desktop/finrobot/engine/compute/operators/audit/
License: Apache-2.0

Adaptation posture:
- retain zero-I/O audit mechanics and selected upstream behavioral contracts;
- replace FinRobot FinancialData/ThesisResult/Finding models with bounded LiOS-owned
  scalar/list inputs and a minimal immutable AuditFinding value object;
- remove donor provider, cache, store, server, agent, routing and persistence seams;
- add fail-closed finite-number checks before financial audit logic;
- return challenger/review findings only. This module does not calculate canonical
  P11 valuations, fetch evidence, assign observed truth, or authorize actions.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional

SOURCE_REPOSITORY = "AI4Finance-Foundation/FinRobot"
SOURCE_COMMIT = "2717499b8e30f242640af08c4ad9afd1113c2d45"
METHOD = "finrobot_v2_audit_apache2_adaptation_v1"


@dataclass(frozen=True)
class AuditFinding:
    field_key: str
    check: str
    severity: str
    evidence: str


@dataclass(frozen=True)
class MomentumContext:
    one_year_return_pct: Optional[float]
    range_position_52w: Optional[float]
    drawdown_from_52w_high_pct: Optional[float]


def _finite_optional(name: str, value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    if type(value) not in (int, float) or not math.isfinite(float(value)):
        raise ValueError(f"{name} must be a finite number when supplied.")
    return float(value)


def _currency(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty currency code.")
    normalized = value.strip().upper()
    if len(normalized) > 16 or any(ord(ch) < 32 for ch in normalized):
        raise ValueError(f"{name} is invalid.")
    return normalized


_US_COUNTRY_TOKENS = frozenset({"US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"})


def audit_currency_caliber(
    ticker: str,
    reporting_currency: str,
    quote_currency: str,
    *,
    pe_ratio: Optional[float] = None,
    enterprise_value: Optional[float] = None,
    ev_ebitda: Optional[float] = None,
    ev_revenue: Optional[float] = None,
    country: Optional[str] = None,
    adr_status: Optional[bool] = None,
    fx_normalized: bool = False,
) -> list[AuditFinding]:
    """Detect mixed-currency ratios and ambiguous foreign double-USD tags."""
    reporting = _currency(reporting_currency, "reporting_currency")
    quote = _currency(quote_currency, "quote_currency")
    values = {
        "pe_ratio": _finite_optional("pe_ratio", pe_ratio),
        "enterprise_value": _finite_optional("enterprise_value", enterprise_value),
        "ev_ebitda": _finite_optional("ev_ebitda", ev_ebitda),
        "ev_revenue": _finite_optional("ev_revenue", ev_revenue),
    }
    findings: list[AuditFinding] = []
    if reporting != quote:
        for field_key, value in values.items():
            if value is not None:
                findings.append(
                    AuditFinding(
                        field_key,
                        "cross_currency_ratio",
                        "blocked_field",
                        f"{ticker}: {field_key}={value} mixes reporting currency {reporting} "
                        f"with quote currency {quote}; FX-normalize before forming the ratio.",
                    )
                )
        return findings

    if reporting == "USD" and quote == "USD" and not fx_normalized and adr_status is None:
        country_text = (country or "").strip()
        if country_text and country_text.upper() not in _US_COUNTRY_TOKENS:
            findings.append(
                AuditFinding(
                    "reporting_currency",
                    "foreign_issuer_usd_tags",
                    "review",
                    f"{ticker}: foreign issuer country={country_text!r} has USD reporting and quote "
                    "tags with no FX-normalization trace and no confirmed ADR status; verify filing currency.",
                )
            )
    return findings


def audit_ev_bridge(
    ticker: str,
    enterprise_value: Optional[float],
    preferred_stock: Optional[float],
    noncontrolling_interest: Optional[float],
) -> list[AuditFinding]:
    """Surface EV bridge components that the evidence/provider did not report."""
    ev = _finite_optional("enterprise_value", enterprise_value)
    preferred = _finite_optional("preferred_stock", preferred_stock)
    nci = _finite_optional("noncontrolling_interest", noncontrolling_interest)
    if ev is None:
        return []
    findings: list[AuditFinding] = []
    for value, label in ((preferred, "preferred stock"), (nci, "noncontrolling interest")):
        if value is None:
            findings.append(
                AuditFinding(
                    "enterprise_value",
                    "ev_bridge_unverified",
                    "review",
                    f"{ticker}: {label} was not reported; EV assumes zero for that component. "
                    f"If the issuer carries {label}, EV and EV multiples are understated.",
                )
            )
    return findings


_MIN_QUARTER_GAP_DAYS = 45
_MAX_QUARTER_GAP_DAYS = 135
_MIN_SEMIANNUAL_GAP_DAYS = 150
_MAX_SEMIANNUAL_GAP_DAYS = 225


def _classify_cadence(gaps: list[int]) -> str:
    non_overlap = [gap for gap in gaps if gap >= _MIN_QUARTER_GAP_DAYS]
    if non_overlap and all(_MIN_SEMIANNUAL_GAP_DAYS <= gap <= _MAX_SEMIANNUAL_GAP_DAYS for gap in non_overlap):
        return "semiannual"
    return "quarterly"


def audit_ttm_period(ticker: str, period_ends: Iterable[date]) -> list[AuditFinding]:
    """Check that supplied period ends form exactly one twelve-month TTM window."""
    ends = list(period_ends)
    if not ends:
        return []
    if any(not isinstance(value, date) for value in ends):
        raise ValueError("period_ends must contain date values only.")
    if len(ends) > 16:
        raise ValueError("period_ends is bounded to 16 values.")
    ordered = sorted(ends, reverse=True)
    gaps = [(newer - older).days for newer, older in zip(ordered, ordered[1:])]
    cadence = _classify_cadence(gaps)
    expected = 2 if cadence == "semiannual" else 4
    legit_max = _MAX_SEMIANNUAL_GAP_DAYS if cadence == "semiannual" else _MAX_QUARTER_GAP_DAYS
    period_word = "half-year" if cadence == "semiannual" else "quarter"
    findings: list[AuditFinding] = []
    for newer, older in zip(ordered, ordered[1:]):
        gap = (newer - older).days
        if gap < _MIN_QUARTER_GAP_DAYS:
            findings.append(
                AuditFinding(
                    "ttm_period",
                    "ttm_quarter_overlap",
                    "blocked_field",
                    f"{ticker}: period ends {older.isoformat()} and {newer.isoformat()} are {gap}d apart; "
                    "they are not distinct periods and may double-count a restatement.",
                )
            )
        elif gap > legit_max:
            findings.append(
                AuditFinding(
                    "ttm_period",
                    "ttm_quarter_gap",
                    "blocked_field",
                    f"{ticker}: {period_word} ends {older.isoformat()} and {newer.isoformat()} are {gap}d apart; "
                    f"the {cadence} TTM window appears to be missing a period.",
                )
            )
    if len(ordered) < expected:
        findings.append(
            AuditFinding(
                "ttm_period",
                "ttm_quarters_incomplete",
                "review",
                f"{ticker}: TTM contains {len(ordered)} {period_word}(s), not {expected}; verify incomplete coverage.",
            )
        )
    elif len(ordered) > expected:
        findings.append(
            AuditFinding(
                "ttm_period",
                "ttm_quarters_excess",
                "blocked_field",
                f"{ticker}: TTM contains {len(ordered)} {period_word}-ends, not {expected}; an extra period would overstate TTM.",
            )
        )
    return findings


def _is_balance_sheet_financial(industry: Optional[str]) -> bool:
    if not industry:
        return False
    value = industry.strip().lower()
    if "insurance - brokers" in value or "insurance broker" in value:
        return False
    if "capital markets" in value or "asset management" in value or "credit services" in value:
        return False
    bank_tokens = ("bank", "banks", "savings & loan", "mortgage finance")
    insurer_tokens = ("insurance - life", "insurance - diversified", "insurance - property", "insurance - specialty", "reinsurance")
    return any(token in value for token in (*bank_tokens, *insurer_tokens))


def audit_sector_sign(
    ticker: str,
    industry: Optional[str],
    net_income: Optional[float],
    operating_income: Optional[float],
    revenue: Optional[float],
    *,
    enterprise_value: Optional[float] = None,
    ev_ebitda: Optional[float] = None,
) -> list[AuditFinding]:
    """Review sector-inapplicable EV metrics and economically NM headline P/E."""
    net = _finite_optional("net_income", net_income)
    operating = _finite_optional("operating_income", operating_income)
    rev = _finite_optional("revenue", revenue)
    ev = _finite_optional("enterprise_value", enterprise_value)
    ev_ebitda_value = _finite_optional("ev_ebitda", ev_ebitda)
    findings: list[AuditFinding] = []
    if _is_balance_sheet_financial(industry):
        for field_key, value in (("enterprise_value", ev), ("ev_ebitda", ev_ebitda_value)):
            if value is not None:
                findings.append(
                    AuditFinding(
                        field_key,
                        "financial_sector_ev_meaningless",
                        "review",
                        f"{ticker} industry={industry!r}: {field_key} is not a clean valuation metric for a "
                        "balance-sheet-funded financial; prefer P/B, P/TBV, ROTCE or DDM conventions.",
                    )
                )
    if net is not None and operating is not None and rev is not None and rev > 0 and net > 0 and (net - operating) / rev > 0.02:
        findings.append(
            AuditFinding(
                "pe_ratio",
                "net_income_exceeds_operating_income",
                "review",
                f"{ticker}: net income exceeds operating income by more than 2% of revenue; non-operating items may inflate headline P/E earnings.",
            )
        )
    if net is not None and net <= 0:
        findings.append(
            AuditFinding(
                "pe_ratio",
                "non_positive_earnings_pe_nm",
                "review",
                f"{ticker}: net income is {net} <= 0, so P/E is not meaningful by economics.",
            )
        )
    return findings


BUY_DIVERGENCE_1Y_RETURN_PCT = -15.0
SELL_DIVERGENCE_1Y_RETURN_PCT = 30.0


def compute_momentum_context(
    current_price: Optional[float],
    high_52w: Optional[float],
    low_52w: Optional[float],
    trailing_1y_return_pct: Optional[float],
) -> MomentumContext:
    current = _finite_optional("current_price", current_price)
    high = _finite_optional("high_52w", high_52w)
    low = _finite_optional("low_52w", low_52w)
    one_year = _finite_optional("trailing_1y_return_pct", trailing_1y_return_pct)
    range_position = None
    drawdown = None
    if current is not None and high is not None and low is not None and high > low and current > 0:
        range_position = (current - low) / (high - low)
    if current is not None and high is not None and high > 0 and current > 0:
        drawdown = (current - high) / high * 100.0
    return MomentumContext(one_year, range_position, drawdown)


def is_momentum_divergent(verdict: Optional[str], one_year_return_pct: Optional[float]) -> bool:
    if verdict is None or one_year_return_pct is None:
        return False
    value = _finite_optional("one_year_return_pct", one_year_return_pct)
    normalized = verdict.strip().upper()
    if normalized == "BUY":
        return bool(value is not None and value < BUY_DIVERGENCE_1Y_RETURN_PCT)
    if normalized == "SELL":
        return bool(value is not None and value > SELL_DIVERGENCE_1Y_RETURN_PCT)
    return False


def audit_momentum_narrative_hedge(
    verdict: Optional[str],
    one_year_return_pct: Optional[float],
    hedge_note: Optional[str],
) -> Optional[str]:
    if not is_momentum_divergent(verdict, one_year_return_pct):
        return None
    if hedge_note is not None and hedge_note.strip():
        return None
    assert verdict is not None and one_year_return_pct is not None
    direction = "up" if one_year_return_pct > 0 else "down"
    return (
        f"[NARRATIVE-MOMENTUM] {verdict} recommendation despite the stock being {direction} "
        f"{abs(one_year_return_pct):.1f}% over the trailing year; the narrative must explain the divergence."
    )


_YEAR_RE = re.compile(r"(?<![\w.$])(?:19|20)\d{2}(?!\w)")
_ORDINAL_RE = re.compile(r"\b\d{1,2}(?:st|nd|rd|th)\b", re.IGNORECASE)
_DIGIT_RE = re.compile(r"\d")


def _has_grounding_number(text: str) -> bool:
    stripped = _ORDINAL_RE.sub("", text)
    stripped = _YEAR_RE.sub("", stripped)
    return bool(_DIGIT_RE.search(stripped))


def audit_narrative_numeric_grounding(
    narrative: str,
    catalysts: Iterable[str],
    risks: Iterable[str],
) -> Optional[str]:
    """Warn when non-empty thesis prose has no quantitative anchor.

    Presence of a digit is only a narrative-completeness signal. It does not prove
    that the number is true, cited, observed, entitled, or reconciled; P7 numerical
    evidence remains authoritative for those properties.
    """
    if not isinstance(narrative, str):
        raise ValueError("narrative must be text.")
    catalyst_values = list(catalysts)
    risk_values = list(risks)
    if len(catalyst_values) > 64 or len(risk_values) > 64:
        raise ValueError("Narrative bullet lists are bounded to 64 entries each.")
    if any(not isinstance(value, str) for value in (*catalyst_values, *risk_values)):
        raise ValueError("Narrative bullets must be text.")
    ungrounded: list[str] = []
    if narrative.strip() and not _has_grounding_number(narrative):
        ungrounded.append("narrative")
    for index, value in enumerate(catalyst_values):
        if value.strip() and not _has_grounding_number(value):
            ungrounded.append(f"catalysts[{index}]")
    for index, value in enumerate(risk_values):
        if value.strip() and not _has_grounding_number(value):
            ungrounded.append(f"risks[{index}]")
    if not ungrounded:
        return None
    return (
        f"[NARRATIVE-NUMERIC] {len(ungrounded)} narrative field(s) carry no supporting number "
        f"({', '.join(ungrounded)}). This is a completeness warning only; numeric truth still requires P7/P11 evidence."
    )
