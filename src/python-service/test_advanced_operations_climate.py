import unittest

from advanced_climate import (
    AbatementCurveRequest,
    AbatementProject,
    ClimateAsset,
    ClimateScenario,
    ClimateVaRRequest,
    FinancedEmissionAsset,
    FinancedEmissionsRequest,
    TransitionPathwayRequest,
    climate_var,
    financed_emissions,
    marginal_abatement_curve,
    transition_pathway,
)
from advanced_supply_chain import (
    DisruptionSimulationRequest,
    DisruptionSupplier,
    Facility,
    FacilityLocationRequest,
    ResilienceFrontierRequest,
    Supplier,
    SupplierPortfolioRequest,
    StochasticInventoryRequest,
    disruption_simulation,
    facility_location_milp,
    resilience_frontier,
    stochastic_inventory,
    supplier_portfolio,
)


class AdvancedSupplyChainTests(unittest.TestCase):
    def test_facility_location_known_single_facility_solution(self):
        result = facility_location_milp(FacilityLocationRequest(
            facilities=[Facility(name="A", fixedCost=10, capacity=100), Facility(name="B", fixedCost=50, capacity=100)],
            customerNames=["Customer"], demand=[80], transportCost=[[1], [1]], maxOpenFacilities=1,
        ))
        self.assertEqual(result.openFacilities, ["A"])
        self.assertAlmostEqual(result.totalCost, 90.0, places=7)
        self.assertAlmostEqual(result.shipment["A"]["Customer"], 80.0, places=7)

    def test_stochastic_inventory_reports_valid_probability_and_nonnegative_cost_components(self):
        result = stochastic_inventory(StochasticInventoryRequest(
            demandScenarios=[10, 20, 30, 40, 50], unitPurchaseCost=2, holdingCostPerUnit=1, stockoutCostPerUnit=8,
        ))
        self.assertGreaterEqual(result.optimalOrderQuantity, 0.0)
        self.assertGreaterEqual(result.expectedShortage, 0.0)
        self.assertGreaterEqual(result.expectedLeftover, 0.0)
        self.assertGreaterEqual(result.serviceProbabilityPct, 0.0)
        self.assertLessEqual(result.serviceProbabilityPct, 100.0)

    def test_supplier_portfolio_obeys_demand_and_supplier_cap(self):
        result = supplier_portfolio(SupplierPortfolioRequest(
            suppliers=[Supplier(name="A", unitCost=10, capacity=80, disruptionProbabilityPct=10), Supplier(name="B", unitCost=12, capacity=100, disruptionProbabilityPct=0)],
            demand=100, maxSupplierShare=0.75,
        ))
        self.assertAlmostEqual(sum(result.allocations.values()), 100.0, places=6)
        self.assertLessEqual(result.allocations["A"], 75.000001)
        self.assertAlmostEqual(sum(result.allocationSharesPct.values()), 100.0, places=6)

    def test_disruption_simulation_is_seed_reproducible(self):
        request = DisruptionSimulationRequest(
            suppliers=[DisruptionSupplier(name="A", allocation=20, disruptionProbabilityPct=20)],
            dailyDemand=20, simulations=1000, seed=1729,
        )
        self.assertEqual(disruption_simulation(request), disruption_simulation(request))

    def test_resilience_frontier_returns_each_requested_penalty(self):
        result = resilience_frontier(ResilienceFrontierRequest(
            suppliers=[Supplier(name="A", unitCost=10, capacity=100, disruptionProbabilityPct=10), Supplier(name="B", unitCost=12, capacity=100, disruptionProbabilityPct=0)],
            demand=100, riskPenaltyGrid=[0, 10, 50],
        ))
        self.assertEqual([point.riskPenalty for point in result.points], [0.0, 10.0, 50.0])
        for point in result.points:
            self.assertAlmostEqual(sum(point.allocations.values()), 100.0, places=6)


class AdvancedClimateTests(unittest.TestCase):
    def test_financed_emissions_known_attribution_and_coverage(self):
        result = financed_emissions(FinancedEmissionsRequest(assets=[FinancedEmissionAsset(
            name="Issuer", exposure=100, enterpriseValueIncludingCash=1000, scope1=1000, scope2=500, scope3=500, revenue=1000,
        )]))
        self.assertAlmostEqual(result.financedEmissions, 200.0, places=7)
        self.assertAlmostEqual(result.byAsset["Issuer"], 200.0, places=7)
        self.assertAlmostEqual(result.dataCoveragePct, 100.0, places=7)

    def test_climate_var_selects_largest_loss_scenario(self):
        result = climate_var(ClimateVaRRequest(
            assets=[ClimateAsset(name="Issuer", marketValue=1000, scope12Tonnes=10, annualRevenue=100, ebitdaMarginPct=10, valuationMultiple=1)],
            scenarios=[ClimateScenario(name="Low", carbonPricePerTonne=10), ClimateScenario(name="High", carbonPricePerTonne=100)],
        ))
        self.assertEqual(result.worstScenario, "High")
        self.assertAlmostEqual(result.climateVaR, 1000.0, places=7)
        self.assertAlmostEqual(result.climateVaRPct, 100.0, places=7)

    def test_abatement_curve_is_sorted_and_target_cost_is_partial_project_cost(self):
        result = marginal_abatement_curve(AbatementCurveRequest(
            projects=[AbatementProject(name="Expensive", annualAbatementTonnes=100, annualizedCost=1000), AbatementProject(name="Cheap", annualAbatementTonnes=100, annualizedCost=100)],
            abatementTargetTonnes=150,
        ))
        self.assertEqual([point.name for point in result.curve], ["Cheap", "Expensive"])
        self.assertAlmostEqual(result.targetCost or 0.0, 600.0, places=7)
        self.assertTrue(result.targetAchievable)

    def test_transition_pathway_preserves_aligned_vectors_and_intensity(self):
        result = transition_pathway(TransitionPathwayRequest(
            baseEmissions=100, years=[2026, 2027, 2028], emissionsTargets=[90, 80, 60], carbonPrices=[1, 2, 3], revenueForecast=[10, 20, 30],
        ))
        self.assertEqual(len(result.annualReductionPct), 3)
        self.assertEqual(result.emissionsIntensity, [9.0, 4.0, 2.0])
        self.assertAlmostEqual(result.cumulativeCarbonCost, 430.0, places=7)


if __name__ == "__main__":
    unittest.main()
