import json
import math
from pathlib import Path

import pytest

from advanced_fixed_income import (
    BootstrapCurveRequest,
    CashFlow,
    CurveNode,
    ImmunizationAsset,
    ImmunizationRequest,
    KeyRateRiskRequest,
    SpreadAnalyticsRequest,
    bootstrap_par_curve,
    immunize_duration,
    key_rate_risk,
    spread_analytics,
)


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "fixed_income_known_answers.json"


def _fixture():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _payload(model):
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _assert_finite(value):
    if isinstance(value, float):
        assert math.isfinite(value)
    elif isinstance(value, dict):
        for item in value.values():
            _assert_finite(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _assert_finite(item)


def test_bootstrap_par_curve_matches_independent_known_answer():
    case = _fixture()["annual_flat_par_curve"]
    result = bootstrap_par_curve(BootstrapCurveRequest(**case["input"]))
    expected = case["expected"]

    assert result.discountFactors == pytest.approx(expected["discountFactors"], rel=1e-12, abs=1e-12)
    assert [node.zeroRatePct for node in result.nodes] == pytest.approx(expected["zeroRatesPct"], rel=1e-12, abs=1e-12)
    assert result.forwardRatesPct == pytest.approx(expected["forwardRatesPct"], rel=1e-12, abs=1e-12)
    _assert_finite(_payload(result))


def test_zero_coupon_spread_matches_independent_known_answer():
    case = _fixture()["one_year_zero_coupon_z_spread"]
    result = spread_analytics(SpreadAnalyticsRequest(
        cashFlows=[CashFlow(**item) for item in case["input"]["cashFlows"]],
        curve=[CurveNode(**item) for item in case["input"]["curve"]],
        marketPrice=case["input"]["marketPrice"],
    ))
    expected = case["expected"]

    assert result.zSpreadBps == pytest.approx(expected["zSpreadBps"], abs=1e-8)
    assert result.modelPrice == pytest.approx(expected["modelPrice"], rel=1e-12, abs=1e-12)
    assert result.spreadDurationYears == pytest.approx(expected["spreadDurationYears"], rel=1e-10, abs=1e-10)
    assert result.dv01 == pytest.approx(expected["dv01"], rel=1e-10, abs=1e-12)
    _assert_finite(_payload(result))


def test_duration_immunization_matches_independent_known_answer():
    case = _fixture()["two_asset_duration_immunization"]
    result = immunize_duration(ImmunizationRequest(
        assets=[ImmunizationAsset(**item) for item in case["input"]["assets"]],
        targetDurationYears=case["input"]["targetDurationYears"],
    ))
    expected = case["expected"]

    for asset, weight in expected["weights"].items():
        assert result.weights[asset] == pytest.approx(weight, rel=1e-8, abs=1e-8)
    assert sum(result.weights.values()) == pytest.approx(1.0, abs=1e-10)
    assert result.achievedDurationYears == pytest.approx(expected["achievedDurationYears"], abs=1e-9)
    _assert_finite(_payload(result))


def test_fixed_income_advanced_paths_are_repeatable():
    fixture = _fixture()
    curve_req = BootstrapCurveRequest(**fixture["annual_flat_par_curve"]["input"])
    imm_case = fixture["two_asset_duration_immunization"]["input"]
    imm_req = ImmunizationRequest(
        assets=[ImmunizationAsset(**item) for item in imm_case["assets"]],
        targetDurationYears=imm_case["targetDurationYears"],
    )
    assert _payload(bootstrap_par_curve(curve_req)) == _payload(bootstrap_par_curve(curve_req))
    assert _payload(immunize_duration(imm_req)) == _payload(immunize_duration(imm_req))


def test_spread_analytics_rejects_non_finite_cash_flow_amount():
    request = SpreadAnalyticsRequest(
        cashFlows=[CashFlow(timeYears=1.0, amount=float("nan"))],
        curve=[CurveNode(maturityYears=1.0, zeroRatePct=5.0)],
        marketPrice=95.0,
    )
    with pytest.raises(ValueError, match="finite"):
        spread_analytics(request)


def test_spread_analytics_rejects_non_finite_market_price():
    request = SpreadAnalyticsRequest(
        cashFlows=[CashFlow(timeYears=1.0, amount=100.0)],
        curve=[CurveNode(maturityYears=1.0, zeroRatePct=5.0)],
        marketPrice=float("inf"),
    )
    with pytest.raises(ValueError, match="finite"):
        spread_analytics(request)


def test_key_rate_risk_rejects_non_finite_key_maturity():
    request = KeyRateRiskRequest(
        cashFlows=[CashFlow(timeYears=1.0, amount=100.0)],
        curve=[CurveNode(maturityYears=1.0, zeroRatePct=5.0)],
        keyMaturitiesYears=[float("nan")],
        bumpBps=1.0,
    )
    with pytest.raises(ValueError, match="finite"):
        key_rate_risk(request)


def test_immunization_rejects_non_finite_duration():
    request = ImmunizationRequest(
        assets=[
            ImmunizationAsset(name="A", price=100.0, durationYears=2.0),
            ImmunizationAsset(name="B", price=100.0, durationYears=float("inf")),
        ],
        targetDurationYears=3.0,
    )
    with pytest.raises(ValueError, match="finite"):
        immunize_duration(request)


def test_immunization_rejects_non_finite_target_duration():
    request = ImmunizationRequest(
        assets=[
            ImmunizationAsset(name="A", price=100.0, durationYears=2.0),
            ImmunizationAsset(name="B", price=100.0, durationYears=6.0),
        ],
        targetDurationYears=float("inf"),
    )
    with pytest.raises(ValueError, match="finite"):
        immunize_duration(request)


def test_immunization_rejects_duplicate_asset_names():
    request = ImmunizationRequest(
        assets=[
            ImmunizationAsset(name="DUP", price=100.0, durationYears=2.0),
            ImmunizationAsset(name="DUP", price=100.0, durationYears=6.0),
        ],
        targetDurationYears=3.0,
    )
    with pytest.raises(ValueError, match="unique"):
        immunize_duration(request)
