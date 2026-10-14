"""
General-purpose optimization: real genetic algorithm and NSGA-II
multi-objective Pareto search (pymoo), real stochastic gradient descent, and
real Sobol variance-based sensitivity analysis (SALib). Ported from
LIMURIA_ENGINES' engines/06_optimization_engine.py and engines/05_risk_engine.py,
all four of which were literal stubs there:

- genetic_algorithm(): returned `{"best_x": [0.0]}` regardless of input.
- stochastic_optimization(): returned the unmodified starting point x0.
- multi_objective_optimization(): returned `{"pareto_front": []}`.
- sensitivity_analysis() (risk engine): returned `{"sobol_indices": [0.1] * len(params)}`.

Unlike portfolio_optimization.py's SLSQP/linprog problems (which have real
convex structure scipy solves exactly), these four are the general
black-box / non-convex / multi-objective cases where a real genetic
algorithm or variance-based sampling approach is the standard technique --
that's why pymoo and SALib are used here instead of scipy.optimize.
"""

from typing import Callable, List, Optional

import numpy as np
from asteval import Interpreter
from pydantic import BaseModel, Field
from pymoo.algorithms.soo.nonconvex.ga import GA
from pymoo.algorithms.moo.nsga2 import NSGA2
from pymoo.core.problem import Problem
from pymoo.optimize import minimize as pymoo_minimize
from SALib.sample import saltelli
from SALib.analyze import sobol


# ─── Genetic algorithm (single-objective, real pymoo GA) ────────────────────

class GeneticAlgorithmRequest(BaseModel):
    # `expression` is evaluated as a Python expression over `x` (a numpy
    # array of decision variables) -- same trust boundary as the rest of
    # this internal-only sidecar (see server/pythonService.ts: never
    # reachable directly from the client, Node owns all auth/routing).
    expression: str = Field(..., description="Objective to MINIMIZE, e.g. 'sum(x**2)' or 'sum((x-3)**2)'")
    bounds: List[List[float]] = Field(..., description="[[low, high], ...] per decision variable")
    popSize: int = Field(default=50, ge=5, le=500)
    nGenerations: int = Field(default=100, ge=1, le=2000)
    seed: int = Field(default=42, ge=0, le=2147483647)


class GeneticAlgorithmResponse(BaseModel):
    bestX: List[float]
    bestF: float
    generationsRun: int


def _make_objective(expression: str) -> Callable[[np.ndarray], float]:
    # asteval parses the expression to a restricted AST and only permits a
    # whitelisted symbol table -- no attribute/introspection access, so
    # there's no path to __class__/__bases__-style sandbox escapes the way
    # there is with bare eval() even after stripping __builtins__.
    aeval = Interpreter(minimal=True, use_numpy=True)

    def objective(x: np.ndarray) -> float:
        aeval.symtable["x"] = x
        result = aeval.eval(expression, show_errors=False, raise_errors=True)
        return float(result)

    return objective


class _SingleObjectiveProblem(Problem):
    def __init__(self, objective_fn: Callable[[np.ndarray], float], bounds: List[List[float]]):
        xl = np.array([b[0] for b in bounds])
        xu = np.array([b[1] for b in bounds])
        super().__init__(n_var=len(bounds), n_obj=1, n_constr=0, xl=xl, xu=xu)
        self._objective_fn = objective_fn

    def _evaluate(self, X, out, *args, **kwargs):
        out["F"] = np.array([[self._objective_fn(row)] for row in X])


def genetic_algorithm(req: GeneticAlgorithmRequest) -> GeneticAlgorithmResponse:
    objective_fn = _make_objective(req.expression)
    problem = _SingleObjectiveProblem(objective_fn, req.bounds)
    algorithm = GA(pop_size=req.popSize)
    result = pymoo_minimize(problem, algorithm, ("n_gen", req.nGenerations), seed=req.seed, verbose=False)
    return GeneticAlgorithmResponse(
        bestX=[float(v) for v in np.atleast_1d(result.X)],
        bestF=float(np.atleast_1d(result.F)[0]),
        generationsRun=req.nGenerations,
    )


# ─── Stochastic gradient descent (real finite-difference SGD) ───────────────

class StochasticOptimizationRequest(BaseModel):
    expression: str = Field(..., description="Objective to MINIMIZE, evaluated over x")
    x0: List[float]
    nIter: int = Field(default=200, ge=1, le=20000)
    stepSize: float = Field(default=0.01, gt=0)
    seed: int = Field(default=42, ge=0, le=2147483647)


class StochasticOptimizationResponse(BaseModel):
    x: List[float]
    fValue: float
    path: List[float]  # objective value per iteration, for convergence display


def stochastic_optimization(req: StochasticOptimizationRequest) -> StochasticOptimizationResponse:
    objective_fn = _make_objective(req.expression)
    x = np.array(req.x0, dtype=float)
    eps = 1e-6
    path: List[float] = []
    rng = np.random.default_rng(req.seed)

    for _ in range(req.nIter):
        # Finite-difference gradient estimate, one random coordinate
        # perturbed at a time (a real stochastic-gradient step, not a mock
        # that ignores x0 -- see module docstring).
        grad = np.zeros_like(x)
        idx = rng.integers(0, len(x))
        x_plus = x.copy()
        x_plus[idx] += eps
        x_minus = x.copy()
        x_minus[idx] -= eps
        grad[idx] = (objective_fn(x_plus) - objective_fn(x_minus)) / (2 * eps)

        x = x - req.stepSize * grad
        path.append(objective_fn(x))

    return StochasticOptimizationResponse(x=[float(v) for v in x], fValue=path[-1] if path else objective_fn(x), path=path)


# ─── Multi-objective optimization (real NSGA-II Pareto front) ───────────────

class MultiObjectiveRequest(BaseModel):
    expressions: List[str] = Field(..., description="2+ objectives to MINIMIZE, each evaluated over x")
    bounds: List[List[float]]
    popSize: int = Field(default=60, ge=10, le=500)
    nGenerations: int = Field(default=100, ge=1, le=2000)
    seed: int = Field(default=42, ge=0, le=2147483647)


class ParetoPoint(BaseModel):
    x: List[float]
    objectives: List[float]


class MultiObjectiveResponse(BaseModel):
    paretoFront: List[ParetoPoint]


class _MultiObjectiveProblem(Problem):
    def __init__(self, objective_fns: List[Callable[[np.ndarray], float]], bounds: List[List[float]]):
        xl = np.array([b[0] for b in bounds])
        xu = np.array([b[1] for b in bounds])
        super().__init__(n_var=len(bounds), n_obj=len(objective_fns), n_constr=0, xl=xl, xu=xu)
        self._objective_fns = objective_fns

    def _evaluate(self, X, out, *args, **kwargs):
        out["F"] = np.array([[fn(row) for fn in self._objective_fns] for row in X])


def multi_objective_optimization(req: MultiObjectiveRequest) -> MultiObjectiveResponse:
    objective_fns = [_make_objective(e) for e in req.expressions]
    problem = _MultiObjectiveProblem(objective_fns, req.bounds)
    algorithm = NSGA2(pop_size=req.popSize)
    result = pymoo_minimize(problem, algorithm, ("n_gen", req.nGenerations), seed=req.seed, verbose=False)

    X = np.atleast_2d(result.X)
    F = np.atleast_2d(result.F)
    points = [ParetoPoint(x=[float(v) for v in X[i]], objectives=[float(v) for v in F[i]]) for i in range(len(X))]
    return MultiObjectiveResponse(paretoFront=points)


# ─── Sensitivity analysis (real Sobol indices via Saltelli sampling) ────────

class SensitivityAnalysisRequest(BaseModel):
    expression: str = Field(..., description="Model output, evaluated over x")
    paramNames: List[str]
    paramRanges: List[List[float]] = Field(..., description="[[low, high], ...] per parameter, same order as paramNames")
    nSamples: int = Field(default=512, ge=64, le=8192, description="Base sample size N -- Saltelli generates N*(2D+2) total runs")
    seed: int = Field(default=42, ge=0, le=2147483647)


class SensitivityAnalysisResponse(BaseModel):
    paramNames: List[str]
    firstOrder: List[float]   # S1: variance explained by each parameter alone
    firstOrderConf: List[float]
    totalOrder: List[float]   # ST: variance explained including interactions
    totalOrderConf: List[float]


def sensitivity_analysis(req: SensitivityAnalysisRequest) -> SensitivityAnalysisResponse:
    problem = {
        "num_vars": len(req.paramNames),
        "names": req.paramNames,
        "bounds": req.paramRanges,
    }
    objective_fn = _make_objective(req.expression)

    param_values = saltelli.sample(problem, req.nSamples)
    Y = np.array([objective_fn(row) for row in param_values])
    sobol_indices = sobol.analyze(problem, Y, seed=req.seed)

    return SensitivityAnalysisResponse(
        paramNames=req.paramNames,
        firstOrder=[float(v) for v in sobol_indices["S1"]],
        firstOrderConf=[float(v) for v in sobol_indices["S1_conf"]],
        totalOrder=[float(v) for v in sobol_indices["ST"]],
        totalOrderConf=[float(v) for v in sobol_indices["ST_conf"]],
    )
