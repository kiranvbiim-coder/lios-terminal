import json
import math
from pathlib import Path

import pytest

from advanced_portfolio import FactorRiskRequest, factor_risk_optimize


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "factor_risk_known_answers.json"


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


def test_factor_risk_matches_idiosyncratic_only_known_answer():
    case = _fixture()["idio_only_minimum_risk"]
    result = factor_risk_optimize(FactorRiskRequest(**case["input"]))
    expected = case["expected"]

    for asset, value in expected["weights"].items():
        assert result.weights[asset] == pytest.approx(value, rel=1e-6, abs=1e-7)
    assert result.factorExposures == pytest.approx(expected["factorExposures"], abs=1e-9)
    assert result.expectedReturnPct == pytest.approx(expected["expectedReturnPct"], abs=1e-9)
    assert result.volatilityPct == pytest.approx(expected["volatilityPct"], rel=1e-7, abs=1e-9)
    assert sum(result.weights.values()) == pytest.approx(1.0, abs=1e-9)
    _assert_finite(_payload(result))


def test_factor_risk_respects_active_factor_exposure_cap_known_answer():
    case = _fixture()["active_factor_cap"]
    result = factor_risk_optimize(FactorRiskRequest(**case["input"]))
    expected = case["expected"]

    for asset, value in expected["weights"].items():
        assert result.weights[asset] == pytest.approx(value, rel=1e-6, abs=1e-6)
    assert result.factorExposures == pytest.approx(expected["factorExposures"], abs=1e-6)
    assert result.expectedReturnPct == pytest.approx(expected["expectedReturnPct"], abs=1e-6)
    assert result.volatilityPct == pytest.approx(expected["volatilityPct"], rel=1e-6, abs=1e-6)
    assert abs(result.factorExposures[0]) <= 0.4 + 1e-8
    assert sum(result.weights.values()) == pytest.approx(1.0, abs=1e-9)
    _assert_finite(_payload(result))


def test_factor_risk_is_repeatable_for_identical_inputs():
    request = FactorRiskRequest(**_fixture()["active_factor_cap"]["input"])
    assert _payload(factor_risk_optimize(request)) == _payload(factor_risk_optimize(request))


@pytest.mark.parametrize(
    "override",
    [
        {"expectedReturnsPct": [float("nan"), 0.0]},
        {"factorLoadings": [[float("inf")], [0.0]]},
        {"factorCovMatrix": [[float("nan")]]},
        {"idiosyncraticVariancePct2": [0.04, float("inf")]},
        {"maxFactorExposureAbs": [float("nan")]},
    ],
)
def test_factor_risk_rejects_non_finite_inputs(override):
    payload = dict(_fixture()["active_factor_cap"]["input"])
    payload.update(override)
    with pytest.raises(ValueError, match="finite"):
        factor_risk_optimize(FactorRiskRequest(**payload))


def test_factor_risk_rejects_negative_idiosyncratic_variance():
    payload = dict(_fixture()["idio_only_minimum_risk"]["input"])
    payload["idiosyncraticVariancePct2"] = [0.04, -0.01]
    with pytest.raises(ValueError, match="idiosyncratic.*non-negative"):
        factor_risk_optimize(FactorRiskRequest(**payload))


def test_factor_risk_rejects_nonsymmetric_factor_covariance():
    payload = dict(_fixture()["idio_only_minimum_risk"]["input"])
    payload["factorLoadings"] = [[0.0, 0.0], [0.0, 0.0]]
    payload["factorCovMatrix"] = [[1.0, 0.4], [0.1, 1.0]]
    with pytest.raises(ValueError, match="symmetric"):
        factor_risk_optimize(FactorRiskRequest(**payload))


def test_factor_risk_rejects_non_psd_factor_covariance():
    payload = dict(_fixture()["idio_only_minimum_risk"]["input"])
    payload["factorLoadings"] = [[0.0, 0.0], [0.0, 0.0]]
    payload["factorCovMatrix"] = [[1.0, 2.0], [2.0, 1.0]]
    with pytest.raises(ValueError, match="positive semidefinite"):
        factor_risk_optimize(FactorRiskRequest(**payload))


def test_factor_risk_rejects_duplicate_asset_names():
    payload = dict(_fixture()["idio_only_minimum_risk"]["input"])
    payload["assets"] = ["DUP", "DUP"]
    with pytest.raises(ValueError, match="unique"):
        factor_risk_optimize(FactorRiskRequest(**payload))
