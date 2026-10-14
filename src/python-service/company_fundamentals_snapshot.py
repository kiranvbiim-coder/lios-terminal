"""P11 deterministic, provider-free company fundamentals from explicitly supplied facts.

No inference of periods, units, source rights, evidence quality or missing numbers.
This is a calculation leaf, NOT an engine registry, router or provider connector.
"""
from __future__ import annotations

import re
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from typing import Any

_DECIMAL_PATTERN = re.compile(r"[+-]?(?:\d+(?:\.\d+)?|\.\d+)\Z")
_INPUT_CLASSES = frozenset({
    "source_cited", "observed", "calculated", "estimated", "user_assumption", "ai_inference", "unknown"
})
_PERIOD_TYPES = frozenset({"fiscal_year", "fiscal_quarter", "fiscal_half", "trailing_twelve_months"})
_RATIO_SCALE = Decimal("0.000000000001")


def _decimal(value: Any, path: str) -> Decimal:
    if not isinstance(value, str) or not _DECIMAL_PATTERN.fullmatch(value):
        raise ValueError(f"{path} must be a finite base-10 decimal string")
    if len(value.lstrip("+-").replace(".", "")) > 40:
        raise ValueError(f"{path} exceeds the 40-digit input limit")
    result = Decimal(value)
    if not result.is_finite():
        raise ValueError(f"{path} must be finite")
    return result


def _required_text(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 256:
        raise ValueError(f"{path} must be a non-empty text value (max 256 characters)")
    return value


def _snapshot(data: Any, label: str) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError(f"{label} must be an object")
    period_id = _required_text(data.get("periodId"), f"{label}.periodId")
    period_type = data.get("periodType")
    if period_type not in _PERIOD_TYPES:
        raise ValueError(f"{label}.periodType must be an explicit supported period type")
    facts = data.get("facts")
    if not isinstance(facts, dict):
        raise ValueError(f"{label}.facts must be an object")
    validated: dict[str, dict[str, Any]] = {}
    for name, supplied in facts.items():
        _required_text(name, f"{label} fact key")
        if not isinstance(supplied, dict):
            raise ValueError(f"{label}.{name} must be a fact object")
        value = _decimal(supplied.get("value"), f"{label}.{name}.value")
        unit = _required_text(supplied.get("unit"), f"{label}.{name}.unit")
        input_class = supplied.get("inputClass")
        if input_class not in _INPUT_CLASSES:
            raise ValueError(f"{label}.{name}.inputClass must be an explicit supported class")
        source_ref = supplied.get("sourceRef")
        if source_ref is not None:
            source_ref = _required_text(source_ref, f"{label}.{name}.sourceRef")
        if input_class == "source_cited" and not source_ref:
            raise ValueError(f"{label}.{name}: source_cited requires sourceRef")
        validated[name] = {
            "value": value, "unit": unit, "inputClass": input_class, "sourceRef": source_ref,
        }
    comparable = data.get("comparablePriorPeriodId")
    if comparable is not None:
        comparable = _required_text(comparable, f"{label}.comparablePriorPeriodId")
    return {"periodId": period_id, "periodType": period_type, "comparablePriorPeriodId": comparable, "facts": validated}


def _string(value: Decimal) -> str:
    result = format(value, "f")
    if "." in result:
        result = result.rstrip("0").rstrip(".")
    return "0" if result in ("-0", "") else result


def company_fundamentals_snapshot(request: dict[str, Any]) -> dict[str, Any]:
    """Compute nine metrics; each impossible metric reports why rather than inventing values.

    Ratio/percentage results use 12 decimal places and ROUND_HALF_EVEN. All other
    arithmetic (especially net debt) is exact Decimal arithmetic.
    """
    if not isinstance(request, dict):
        raise ValueError("request must be an object")
    current = _snapshot(request.get("current"), "current")
    prior = _snapshot(request["prior"], "prior") if request.get("prior") is not None else None
    scopes = {"current": current, "prior": prior}
    out: dict[str, dict[str, Any]] = {}

    def metric(name: str, required: tuple[str, ...], kind: str, operation: str) -> None:
        contributing = []
        missing = []
        for key in required:
            period, field = key.split(".", 1)
            snap = scopes[period]
            fact = snap["facts"].get(field) if snap else None
            if fact is None:
                missing.append(key)
            else:
                contributing.append({"key": key, "value": _string(fact["value"]),
                                     "unit": fact["unit"], "inputClass": fact["inputClass"],
                                     "sourceRef": fact["sourceRef"]})
        def unavailable(reason: str) -> None:
            out[name] = {"status": "not_computable", "value": None, "unit": kind,
                         "requiredFacts": list(required), "contributingFacts": contributing,
                         "missingFacts": missing, "reason": reason}
        if missing:
            unavailable("missing required facts: " + ", ".join(missing))
            return
        if operation == "growth" and (not prior or
            current["periodType"] != prior["periodType"] or
            current["periodId"] == prior["periodId"] or
            current["comparablePriorPeriodId"] != prior["periodId"]):
            unavailable("prior period must be different, same type, and explicitly linked as comparable")
            return
        facts = [scopes[key.split(".", 1)[0]]["facts"][key.split(".", 1)[1]] for key in required]
        if len({fact["unit"] for fact in facts}) != 1:
            unavailable("incompatible fact units; no FX or scale conversion is performed")
            return
        values = [fact["value"] for fact in facts]
        if operation in ("net_debt", "debt_to_ebitda", "net_debt_to_ebitda") and (values[0] < 0 or values[1] < 0):
            unavailable("debt components must be non-negative")
            return
        if operation == "net_debt" or operation == "net_debt_to_ebitda":
            if values[2] < 0:
                unavailable("cash must be non-negative")
                return
        if operation == "growth":
            numerator, denominator = values[0] - values[1], values[1]
        elif operation == "net_debt":
            # Decimal arithmetic outside a context defaults to 28 digits and would
            # silently round large monetary balances and their small adjustments.
            with localcontext() as ctx:
                ctx.prec = 100
                result = values[0] + values[1] - values[2]
            out[name] = {"status": "computed", "value": _string(result), "unit": facts[0]["unit"],
                         "requiredFacts": list(required), "contributingFacts": contributing,
                         "missingFacts": [], "reason": None}
            return
        elif operation == "debt_to_ebitda":
            numerator, denominator = values[0] + values[1], values[2]
        elif operation == "net_debt_to_ebitda":
            numerator, denominator = values[0] + values[1] - values[2], values[3]
        else:
            numerator, denominator = values[0], values[1]
        if denominator <= 0:
            unavailable("denominator must be strictly positive")
            return
        with localcontext() as ctx:
            ctx.prec = 80
            result = numerator / denominator
            if kind == "percent":
                result *= Decimal(100)
            result = result.quantize(_RATIO_SCALE, rounding=ROUND_HALF_EVEN)
        out[name] = {"status": "computed", "value": _string(result), "unit": kind,
                     "requiredFacts": list(required), "contributingFacts": contributing,
                     "missingFacts": [], "reason": None}

    metric("revenueGrowthPct", ("current.revenue", "prior.revenue"), "percent", "growth")
    for name, numerator in (
        ("grossMarginPct", "grossProfit"), ("operatingMarginPct", "operatingIncome"),
        ("netMarginPct", "netIncome"), ("freeCashFlowMarginPct", "freeCashFlow"),
    ):
        metric(name, (f"current.{numerator}", "current.revenue"), "percent", "divide")
    metric("currentRatio", ("current.currentAssets", "current.currentLiabilities"), "ratio", "divide")
    metric("netDebt", ("current.shortTermDebt", "current.longTermDebt", "current.cashAndEquivalents"), "currency", "net_debt")
    metric("grossDebtToEbitda", ("current.shortTermDebt", "current.longTermDebt", "current.ebitda"), "ratio", "debt_to_ebitda")
    metric("netDebtToEbitda", ("current.shortTermDebt", "current.longTermDebt", "current.cashAndEquivalents", "current.ebitda"), "ratio", "net_debt_to_ebitda")
    return {"metrics": out, "conventions": {
        "engine": "P11 company fundamentals snapshot", "source": "explicit_supplied_facts_only",
        "arithmetic": "Decimal", "division": "12 fractional decimal places; ROUND_HALF_EVEN",
        "currencyTranslation": "none", "unitConversion": "none", "imputation": "none",
        "periodComparison": "same periodType and explicit comparablePriorPeriodId",
        "provenance": "input class/reference labels are supplied, not independently verified by this calculator",
    }, "currentPeriodId": current["periodId"], "priorPeriodId": prior["periodId"] if prior else None}
