import json
import unittest

import numpy as np

import professional_statistics as stats


class ProfessionalStatisticsTests(unittest.TestCase):
    def test_descriptive_known_answers_and_missingness(self):
        output = stats.descriptive_diagnostics(stats.DescriptiveRequest(data=[1, 2, 3, 4, None, 100]))
        self.assertEqual(output.result["count"], 5)
        self.assertEqual(output.result["missingCount"], 1)
        self.assertAlmostEqual(output.result["median"], 3)
        self.assertEqual(output.result["outliers"]["robustZValues"], [100.0])

    def test_inference_reports_effect_interval_and_power(self):
        output = stats.professional_inference(stats.InferenceRequest(group1=[2, 3, 4, 5, 6], group2=[1, 2, 3, 4, 5]))
        self.assertAlmostEqual(output.result["meanDifference"], 1)
        self.assertIn("hedgesG", output.result["tests"][0]["effectSize"])
        self.assertGreater(output.result["power"]["requiredGroup1SampleSize"], 0)

    def test_paired_interval_uses_difference_variance(self):
        output = stats.professional_inference(stats.InferenceRequest(group1=[2, 4, 7, 8, 10], group2=[1, 2, 4, 5, 6], paired=True))
        low, high = output.result["meanDifferenceConfidenceInterval"]
        expected = np.mean(np.array([2, 4, 7, 8, 10]) - np.array([1, 2, 4, 5, 6]))
        self.assertLess(low, expected)
        self.assertGreater(high, expected)

    def test_multiple_testing_matches_bonferroni_known_answer(self):
        output = stats.multiple_testing(stats.MultipleTestingRequest(pValues=[0.001, 0.01, 0.03, 0.2]))
        adjusted = [row["adjustedPValue"] for row in output.result["corrections"]["bonferroni"]]
        self.assertEqual(adjusted, [0.004, 0.04, 0.12, 0.8])

    def test_seeded_engines_are_byte_reproducible(self):
        request = stats.ResamplingRequest(data=[1, 2, 3, 4, 5, 6, 7, 8], group2=[0, 1, 2, 3, 4, 5, 6, 7], iterations=300, blockLength=3, seed=42)
        first = json.dumps(stats.seeded_resampling(request).model_dump(), sort_keys=True)
        second = json.dumps(stats.seeded_resampling(request).model_dump(), sort_keys=True)
        changed = json.dumps(stats.seeded_resampling(request.model_copy(update={"seed": 43})).model_dump(), sort_keys=True)
        self.assertEqual(first, second)
        self.assertNotEqual(first, changed)

    def test_distribution_fit_returns_fitted_gof_and_qq(self):
        request = stats.DistributionFitRequest(data=[0.8, 1.1, 1.3, 1.4, 1.8, 2, 2.2, 2.5, 3.1, 3.8, 4.2, 5.1], nMcSamples=199, seed=42)
        output = stats.distribution_fit(request)
        self.assertIn(output.result["bestByAic"], ["normal", "student_t", "lognormal", "gamma"])
        self.assertGreater(len(output.result["qq"]), 5)
        self.assertTrue(all("gofPValue" in fit for fit in output.result["fits"] if fit["eligible"]))

    def test_multivariate_diagnostics_and_shrinkage(self):
        matrix = [[i, i * 1.1 + (-1) ** i * 0.1, 10 - i] for i in range(1, 11)]
        output = stats.multivariate_structure(stats.MultivariateRequest(data=matrix, nComponents=2, maxClusters=4, seed=42))
        self.assertAlmostEqual(sum(output.result["pca"]["explainedVarianceRatio"]), 1, places=8)
        self.assertGreaterEqual(output.result["covarianceShrinkage"]["shrinkage"], 0)
        self.assertEqual(len(output.result["clustering"]), 3)

    def test_bayesian_posterior_is_reproducible_and_updates_prior(self):
        request = stats.BayesianNormalRequest(data=[0.01, 0.02, 0.03, 0.015, 0.025, 0.005], priorBeta=0.001, draws=1000, seed=42)
        first = stats.bayesian_normal(request)
        second = stats.bayesian_normal(request)
        self.assertEqual(first.model_dump(), second.model_dump())
        self.assertGreater(first.result["posterior"]["mean"], 0)
        self.assertLess(first.diagnostics["splitRHat"], 1.05)


if __name__ == "__main__":
    unittest.main()
