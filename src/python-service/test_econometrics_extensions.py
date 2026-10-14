import unittest

import numpy as np
import statsmodels.api as sm

import econometrics as econ
import statistics_econometrics as se


class RegressionExtensionTests(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(42)
        self.n = 60
        self.x = rng.standard_normal(self.n)
        self.y = 2 + 3 * self.x + rng.standard_normal(self.n) * (1 + np.abs(self.x))

    def test_hac_and_clustered_se_match_native_statsmodels(self):
        hac = se.ols_diagnostics(se.RegressionRequest(y=self.y.tolist(), x=[self.x.tolist()], covType="HAC", maxLags=3))
        direct_hac = sm.OLS(self.y, sm.add_constant(self.x)).fit(cov_type="HAC", cov_kwds={"maxlags": 3})
        np.testing.assert_allclose(hac.standardErrors, direct_hac.bse.tolist(), atol=1e-10)

        clusters = (np.arange(self.n) % 6).astype(str).tolist()
        clustered = se.ols_diagnostics(se.RegressionRequest(y=self.y.tolist(), x=[self.x.tolist()], covType="cluster", clusterVar=clusters))
        groups = np.unique(np.asarray(clusters), return_inverse=True)[1]
        direct_cluster = sm.OLS(self.y, sm.add_constant(self.x)).fit(cov_type="cluster", cov_kwds={"groups": groups})
        np.testing.assert_allclose(clustered.standardErrors, direct_cluster.bse.tolist(), atol=1e-10)

    def test_gls_hc3_matches_native_wls(self):
        weights = np.linspace(0.5, 2.0, self.n)
        response = se.gls_regression(se.WeightedRegressionRequest(y=self.y.tolist(), x=[self.x.tolist()], weights=weights.tolist(), covType="HC3"))
        direct = sm.WLS(self.y, sm.add_constant(self.x), weights=1.0 / weights).fit(cov_type="HC3")
        np.testing.assert_allclose(response.standardErrors, direct.bse.tolist(), atol=1e-10)

    def test_robust_huber_downweights_gross_outlier(self):
        y = 2 + 1.5 * np.linspace(-3, 3, self.n)
        y[0] += 20
        response = se.robust_regression(se.RobustRegressionRequest(y=y.tolist(), x=[np.linspace(-3, 3, self.n).tolist()], normType="huber"))
        self.assertLess(response.weights[0], 0.3)

    def test_robust_tukey_matches_native_rlm(self):
        x = np.linspace(-2, 2, 30)
        y = 1 + 2 * x
        y[0] += 8
        response = se.robust_regression(se.RobustRegressionRequest(y=y.tolist(), x=[x.tolist()], normType="tukey"))
        from statsmodels.robust.norms import TukeyBiweight
        direct = sm.RLM(y, sm.add_constant(x), M=TukeyBiweight()).fit()
        np.testing.assert_allclose(response.coefficients, direct.params.tolist(), atol=1e-10)

    def test_influence_vif_reset_and_autocorrelation_match_native_apis(self):
        x = np.linspace(-2, 2, 80)
        y = 1 + 2 * x + 0.7 * x**2
        influence = se.influence_diagnostics(se.RegressionRequest(y=y.tolist(), x=[x.tolist()]))
        direct_model = sm.OLS(y, sm.add_constant(x)).fit()
        from statsmodels.stats.outliers_influence import OLSInfluence
        direct_influence = OLSInfluence(direct_model)
        np.testing.assert_allclose(influence.cooksDistance, direct_influence.cooks_distance[0], atol=1e-10)
        np.testing.assert_allclose(influence.studentizedResiduals, direct_influence.resid_studentized_external, atol=1e-10)

        x2 = x**2 + np.linspace(-0.1, 0.1, len(x))
        vif = se.variance_inflation_factors(se.VifRequest(x=[x.tolist(), x2.tolist()]))
        from statsmodels.stats.outliers_influence import variance_inflation_factor
        direct_x = sm.add_constant(np.column_stack([x, x2]))
        np.testing.assert_allclose(vif.vif, [variance_inflation_factor(direct_x, 1), variance_inflation_factor(direct_x, 2)], atol=1e-10)

        reset = se.reset_test(se.RegressionRequest(y=y.tolist(), x=[x.tolist()]))
        from statsmodels.stats.diagnostic import linear_reset
        direct_reset = linear_reset(direct_model, power=3, test_type="fitted", use_f=True)
        self.assertAlmostEqual(reset.statistic, float(direct_reset.fvalue), places=10)

        autocorr = se.autocorrelation_tests(se.AutocorrelationTestRequest(y=self.y.tolist(), x=[self.x.tolist()], lags=3))
        from statsmodels.stats.diagnostic import acorr_breusch_godfrey, acorr_ljungbox
        from statsmodels.stats.stattools import durbin_watson
        bg = acorr_breusch_godfrey(sm.OLS(self.y, sm.add_constant(self.x)).fit(), nlags=3)
        lb = acorr_ljungbox(sm.OLS(self.y, sm.add_constant(self.x)).fit().resid, lags=3)
        self.assertAlmostEqual(autocorr.breuschGodfreyLmStatistic, float(bg[0]), places=10)
        np.testing.assert_allclose(autocorr.ljungBoxPValues, lb["lb_pvalue"].tolist(), atol=1e-10)
        self.assertAlmostEqual(autocorr.durbinWatson, float(durbin_watson(sm.OLS(self.y, sm.add_constant(self.x)).fit().resid)), places=10)


class PanelAndIvExtensionTests(unittest.TestCase):
    def test_mixed_effects_matches_statsmodels_random_slope(self):
        rng = np.random.default_rng(3)
        groups = np.repeat(np.arange(12), 12)
        x = rng.standard_normal(len(groups))
        y = 1 + 2 * x + np.repeat(rng.standard_normal(12), 12) + np.repeat(rng.standard_normal(12) * 0.3, 12) * x + rng.standard_normal(len(groups)) * 0.5
        response = econ.mixed_effects_panel(econ.MixedEffectsRequest(y=y.tolist(), x=[x.tolist()], groups=[str(v) for v in groups], randomSlopeIndex=0))
        from statsmodels.regression.mixed_linear_model import MixedLM
        direct = MixedLM(y, sm.add_constant(x), groups=groups, exog_re=sm.add_constant(x)).fit()
        np.testing.assert_allclose(response.fixedEffectsCoefficients, direct.params[:2].tolist(), atol=1e-6)
        self.assertAlmostEqual(response.randomSlopeVariance, np.asarray(direct.cov_re)[1, 1], places=6)

    def test_clustered_panel_se_matches_native_linearmodels(self):
        rng = np.random.default_rng(11)
        n_entities, n_time = 8, 12
        entities = np.repeat([f"E{i}" for i in range(n_entities)], n_time)
        times = np.tile([f"T{i}" for i in range(n_time)], n_entities)
        x = rng.standard_normal(n_entities * n_time)
        y = 1 + 2 * x + np.repeat(rng.standard_normal(n_entities), n_time) + rng.standard_normal(n_entities * n_time) * 0.5
        response = econ.panel_ols(econ.PanelOlsRequest(y=y.tolist(), x=[x.tolist()], entityIds=entities.tolist(), timeIds=times.tolist(), covType="clustered"))
        import pandas as pd
        from linearmodels import PanelOLS
        frame = pd.DataFrame({"y": y, "entity": entities, "time": pd.factorize(pd.Series(times), sort=True)[0], "x": x}).set_index(["entity", "time"])
        exog = pd.concat([pd.Series(1.0, index=frame.index, name="const"), frame[["x"]]], axis=1)
        direct = PanelOLS(frame.y, exog, entity_effects=True).fit(cov_type="clustered", clusters=pd.Series(entities, index=frame.index))
        np.testing.assert_allclose(response.fixedEffects.standardErrors, direct.std_errors.tolist(), atol=1e-8)

    def test_iv_sargan_is_present_only_when_overidentified(self):
        rng = np.random.default_rng(0)
        n = 160
        z1, z2 = rng.standard_normal((2, n))
        endog = 0.7 * z1 + 0.4 * z2 + rng.standard_normal(n) * 0.5
        y = 1 + 2 * endog + rng.standard_normal(n)
        over = econ.iv_2sls(econ.Iv2SlsRequest(y=y.tolist(), endogenous=[endog.tolist()], instruments=[z1.tolist(), z2.tolist()]))
        self.assertTrue(over.overidentified)
        self.assertIsNotNone(over.sarganStatistic)
        import pandas as pd
        from linearmodels.iv import IV2SLS
        direct = IV2SLS(
            pd.Series(y, name="y"),
            pd.DataFrame({"const": np.ones(n)}),
            pd.DataFrame({"endog0": endog}),
            pd.DataFrame({"instr0": z1, "instr1": z2}),
        ).fit()
        self.assertAlmostEqual(over.sarganStatistic, direct.sargan.stat, places=10)
        self.assertAlmostEqual(over.sarganPValue, direct.sargan.pval, places=10)
        exact = econ.iv_2sls(econ.Iv2SlsRequest(y=y.tolist(), endogenous=[endog.tolist()], instruments=[z1.tolist()]))
        self.assertFalse(exact.overidentified)
        self.assertIsNone(exact.sarganStatistic)
        self.assertIsNone(exact.sarganPValue)
        self.assertIsNone(exact.sarganDegreesOfFreedom)


if __name__ == "__main__":
    unittest.main()
