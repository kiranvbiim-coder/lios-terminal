import json
import math
from pathlib import Path

import pytest

from advanced_portfolio import (
    HrpRequest,
    RegimeBlendRequest,
    RiskBudgetRequest,
    hierarchical_risk_parity,
    regime_conditioned_blend,
    risk_budget_optimization,
)


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "portfolio_optimization_known_answers.json"


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


def test_hrp_matches_independent_two_asset_known_answer():
    case = _fixture()["hrp_two_asset_diagonal"]
    result = hierarchical_risk_parity(HrpRequest(**case["input"]))

    for asset, expected in case["expectedWeights"].items():
        assert result.weights[asset] == pytest.approx(expected, rel=1e-10, abs=1e-10)
    assert sum(result.weights.values()) == pytest.approx(1.0, abs=1e-12)
    _assert_finite(_payload(result))


def test_equal_risk_budget_matches_independent_inverse_volatility_solution():
    case = _fixture()["equal_risk_budget_two_asset_diagonal"]
    result = risk_budget_optimization(RiskBudgetRequest(**case["input"]))

    for asset, expected in case["expectedWeights"].items():
        assert result.weights[asset] == pytest.approx(expected, rel=1e-6, abs=1e-6)
    for asset, expected in case["expectedRiskContributions"].items():
        assert result.riskContributions[asset] == pytest.approx(expected, rel=1e-6, abs=1e-6)
    assert sum(result.weights.values()) == pytest.approx(1.0, abs=1e-9)
    assert sum(result.riskContributions.values()) == pytest.approx(1.0, abs=1e-9)
    assert result.budgetError <= 1e-6
    _assert_finite(_payload(result))


def test_hrp_and_risk_budget_are_repeatable_for_identical_inputs():
    fixture = _fixture()
    hrp_input = HrpRequest(**fixture["hrp_two_asset_diagonal"]["input"])
    budget_input = RiskBudgetRequest(**fixture["equal_risk_budget_two_asset_diagonal"]["input"])

    assert _payload(hierarchical_risk_parity(hrp_input)) == _payload(hierarchical_risk_parity(hrp_input))
    assert _payload(risk_budget_optimization(budget_input)) == _payload(risk_budget_optimization(budget_input))


def test_regime_blend_matches_probability_weighted_known_answer():
    case = _fixture()["regime_blend"]
    result = regime_conditioned_blend(RegimeBlendRequest(**case["input"]))

    for asset, expected in case["expectedWeights"].items():
        assert result.weights[asset] == pytest.approx(expected, abs=1e-12)
    assert sum(result.weights.values()) == pytest.approx(1.0, abs=1e-12)
    _assert_finite(_payload(result))


@pytest.mark.parametrize("bad_probability", [float("nan"), float("inf"), float("-inf")])
def test_regime_blend_rejects_non_finite_probabilities(bad_probability):
    case = _fixture()["regime_blend"]["input"]
    request = RegimeBlendRequest(
        assets=case["assets"],
        regimeProbabilities=[bad_probability, 1.0],
        regimeWeights=case["regimeWeights"],
    )

    with pytest.raises(ValueError, match="finite"):
        regime_conditioned_blend(request)


def test_hrp_rejects_non_finite_covariance():
    case = _fixture()["hrp_two_asset_diagonal"]["input"]
    request = HrpRequest(assets=case["assets"], covMatrix=[[0.04, float("nan")], [float("nan"), 0.09]])
    with pytest.raises(ValueError, match="finite"):
        hierarchical_risk_parity(request)


def test_risk_budget_rejects_non_finite_budget():
    case = _fixture()["equal_risk_budget_two_asset_diagonal"]["input"]
    request = RiskBudgetRequest(
        assets=case["assets"],
        covMatrix=case["covMatrix"],
        riskBudgets=[0.5, float("inf")],
        allowShort=False,
    )
    with pytest.raises(ValueError, match="finite"):
        risk_budget_optimization(request)
