import json
import math
from pathlib import Path

import pytest
from pydantic import ValidationError

from advanced_risk import TailRiskRequest, tail_risk_report


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "risk_tail_known_answers.json"


def _fixture():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _request(overrides=None):
    payload = dict(_fixture()["input"])
    if overrides:
        payload.update(overrides)
    return TailRiskRequest(**payload)


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


def test_tail_risk_matches_independent_known_answers():
    case = _fixture()
    expected = case["expected"]
    result = tail_risk_report(_request())
    assert result.historicalVaR == pytest.approx(expected["historicalVaR"], abs=1e-9)
    assert result.historicalES == pytest.approx(expected["historicalES"], abs=1e-9)
    assert result.gaussianVaR == pytest.approx(expected["gaussianVaR"], rel=1e-10, abs=1e-6)
    assert result.gaussianES == pytest.approx(expected["gaussianES"], rel=1e-10, abs=1e-6)
    assert result.drawdownAtRiskPct == pytest.approx(expected["drawdownAtRiskPct"], rel=1e-10, abs=1e-9)
    assert result.maxDrawdownPct == pytest.approx(expected["maxDrawdownPct"], rel=1e-10, abs=1e-9)
    for asset, value in expected["marginalGaussianVaR"].items():
        assert result.marginalGaussianVaR[asset] == pytest.approx(value, rel=1e-10, abs=1e-6)
    for asset, value in expected["componentGaussianVaR"].items():
        assert result.componentGaussianVaR[asset] == pytest.approx(value, rel=1e-10, abs=1e-6)


def test_seeded_student_t_simulation_is_repeatable_and_response_is_json_safe():
    first = tail_risk_report(_request())
    second = tail_risk_report(_request())
    assert first.studentTMonteCarloVaR == second.studentTMonteCarloVaR
    assert first.studentTMonteCarloES == second.studentTMonteCarloES
    assert first.seed == second.seed == 1729
    _assert_finite(_payload(first))


@pytest.mark.parametrize("bad_value", [float("inf"), float("-inf"), float("nan")])
def test_tail_risk_rejects_non_finite_portfolio_value(bad_value):
    with pytest.raises(ValidationError):
        _request({"portfolioValue": bad_value})


def test_tail_risk_rejects_weights_that_do_not_sum_to_one():
    request = _request({"weights": [0.7, 0.4]})
    with pytest.raises(ValueError, match="weights must sum to 1"):
        tail_risk_report(request)


def test_tail_risk_rejects_return_matrix_dimension_mismatch():
    matrix = [row[:1] for row in _fixture()["input"]["returnsMatrixPct"]]
    request = _request({"returnsMatrixPct": matrix})
    with pytest.raises(ValueError, match="dimensions are invalid"):
        tail_risk_report(request)
