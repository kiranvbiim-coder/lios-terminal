"""Offline deterministic numerical admission probe for the actual release sandbox.

Runs inside the immutable, non-root, network-disabled container smoke. This
covers the compiled NumPy/SciPy numerical stack needed by LiOS P11 reverse DCF.
It does not substitute for the canonical engine-worker request/return transport,
native installer, target-specific image qualification or end-to-end valuation.
"""
from __future__ import annotations

import math

import numpy as np
from pydantic import BaseModel, Field, ValidationError
from scipy.optimize import brentq


class _KnownValuation(BaseModel):
    current_revenue: float = Field(gt=0)
    equity_value: float = Field(gt=0)
    wacc: float = Field(gt=0, lt=1)
    operating_margin: float = Field(ge=0, le=1)
    reinvestment_rate: float = Field(ge=0, le=1)


def verify_core_numerical_runtime() -> dict[str, float]:
    """Independently known one-year reverse-DCF root is zero growth.

    Revenue 100, operating margin 20%, reinvestment 10%, WACC 10%,
    zero tax, debt and terminal growth: explicit + terminal PV = 100.
    A changed Python/scientific-wheel ABI or numerical solver must not allow
    the candidate OCI image to pass its release smoke.
    """
    inputs = _KnownValuation(
        current_revenue=100,
        equity_value=100,
        wacc=0.10,
        operating_margin=0.20,
        reinvestment_rate=0.10,
    )
    try:
        _KnownValuation(current_revenue=-1, equity_value=100, wacc=0.1,
                        operating_margin=0.2, reinvestment_rate=0.1)
    except ValidationError:
        pass
    else:
        raise RuntimeError("Sandbox quantitative Pydantic input validation is unavailable.")

    # Exercise NumPy native array operations as well as SciPy's compiled root solver.
    cash_flow_factors = np.asarray(
        [inputs.operating_margin, -inputs.reinvestment_rate], dtype=np.float64,
    )
    margin_after_reinvestment = float(np.sum(cash_flow_factors))
    if not np.isfinite(margin_after_reinvestment):
        raise RuntimeError("Sandbox quantitative NumPy calculation is nonfinite.")

    def modeled_value(growth: float) -> float:
        revenue = inputs.current_revenue * (1 + growth)
        fcff = revenue * margin_after_reinvestment
        discounted_explicit = fcff / (1 + inputs.wacc)
        terminal_value = fcff / inputs.wacc
        discounted_terminal = terminal_value / (1 + inputs.wacc)
        return discounted_explicit + discounted_terminal

    growth = float(brentq(
        lambda g: modeled_value(g) - inputs.equity_value, -0.9, 2.0,
        xtol=1e-13, maxiter=100,
    ))
    repriced = float(modeled_value(growth))
    if (not math.isfinite(growth) or not math.isfinite(repriced)
            or abs(growth) > 1e-9 or abs(repriced - 100.0) > 1e-7):
        raise RuntimeError("Sandbox quantitative reverse-DCF numerical admission failed.")
    return {"impliedRevenueGrowthPct": growth * 100.0,
            "repricedEquityValue": repriced}


if __name__ == "__main__":
    verify_core_numerical_runtime()
    print("PASS sandbox quant smoke: NumPy/SciPy/Pydantic and known-value reverse DCF")
