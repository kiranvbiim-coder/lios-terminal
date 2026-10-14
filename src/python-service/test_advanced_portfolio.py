import unittest

from portfolio_optimization import (
    GroupWeightConstraint,
    RobustPortfolioRequest,
    robust_constrained_optimization,
)


class RobustPortfolioTests(unittest.TestCase):
    def test_symmetric_assets_produce_equal_allocation(self):
        result = robust_constrained_optimization(RobustPortfolioRequest(
            assets=["A", "B"],
            expectedReturns=[8.0, 8.0],
            covMatrix=[[4.0, 1.0], [1.0, 4.0]],
            allowShort=False,
            riskAversion=1.0,
            uncertaintyAversion=0.0,
        ))
        self.assertAlmostEqual(result.weights["A"], 0.5, places=7)
        self.assertAlmostEqual(result.weights["B"], 0.5, places=7)
        self.assertAlmostEqual(sum(result.weights.values()), 1.0, places=9)

    def test_group_cap_is_enforced_even_when_return_signal_prefers_capped_asset(self):
        result = robust_constrained_optimization(RobustPortfolioRequest(
            assets=["A", "B"],
            expectedReturns=[20.0, 5.0],
            covMatrix=[[4.0, 0.0], [0.0, 4.0]],
            allowShort=False,
            riskAversion=0.01,
            uncertaintyAversion=0.0,
            groupConstraints=[GroupWeightConstraint(name="A-cap", assets=["A"], maxWeight=0.4)],
        ))
        self.assertLessEqual(result.weights["A"], 0.400001)
        self.assertGreaterEqual(result.constraintSlack["group:A-cap:max"], -1e-6)

    def test_mean_uncertainty_penalty_avoids_equally_returning_but_uncertain_asset(self):
        result = robust_constrained_optimization(RobustPortfolioRequest(
            assets=["uncertain", "stable"],
            expectedReturns=[10.0, 10.0],
            covMatrix=[[4.0, 0.0], [0.0, 4.0]],
            allowShort=False,
            riskAversion=0.01,
            uncertaintyAversion=5.0,
            meanUncertaintyPct=[10.0, 0.0],
        ))
        self.assertLess(result.weights["uncertain"], 0.01)
        self.assertGreater(result.weights["stable"], 0.99)

    def test_transaction_costs_and_turnover_are_reported_from_current_holdings(self):
        result = robust_constrained_optimization(RobustPortfolioRequest(
            assets=["A", "B"],
            expectedReturns=[15.0, 5.0],
            covMatrix=[[4.0, 0.0], [0.0, 4.0]],
            allowShort=False,
            currentWeights=[0.5, 0.5],
            transactionCostBps=[25.0, 25.0],
            turnoverLimit=0.2,
            riskAversion=0.01,
            uncertaintyAversion=0.0,
        ))
        self.assertLessEqual(result.turnover, 0.200001)
        self.assertGreaterEqual(result.estimatedTransactionCostPct, 0.0)
        self.assertGreaterEqual(result.constraintSlack["turnover"], -1e-6)

    def test_indefinite_covariance_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "positive semidefinite"):
            robust_constrained_optimization(RobustPortfolioRequest(
                assets=["A", "B"],
                expectedReturns=[8.0, 9.0],
                covMatrix=[[1.0, 2.0], [2.0, 1.0]],
                allowShort=False,
            ))


if __name__ == "__main__":
    unittest.main()
