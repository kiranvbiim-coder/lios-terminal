"""
Options volatility: SABR smile calibration and Heston stochastic-volatility
calibration (LIMURIA_ENGINES port plan Phase 3). Real market use case for
this Terminal specifically: `server/lseData.ts`'s `getOptionsChain()` (via
`/api/lse/options-chain/:underlying`) already returns real per-strike,
per-expiry implied vols for a real chain (confirmed live: 3,340 contracts
across 32 expiries for AAPL) -- SABR/Heston calibration against a handful of
hand-typed points would be pointless when a real, large, noisy market smile
is already one fetch away.

SABR uses Hagan et al.'s (2002) closed-form implied-vol approximation,
fitted via scipy least-squares -- well-documented and independently
verifiable against known reference values, no need for QuantLib here.
Heston uses QuantLib's native calibration engine (HestonModel +
HestonModelHelper + Levenberg-Marquardt) -- genuinely hard to reproduce by
hand (the model has no closed-form vol, pricing requires numerical
integration of its characteristic function).
"""

import math
from typing import List, Optional

import numpy as np
from pydantic import BaseModel, Field
from scipy.optimize import least_squares


# ─── SABR (Hagan et al. 2002 closed-form approximation) ───────────────────
def _hagan_sabr_vol(forward: float, strike: float, expiry: float, alpha: float, beta: float, rho: float, nu: float) -> float:
    """Hagan's SABR implied (Black) volatility approximation."""
    if abs(forward - strike) < 1e-12:
        # ATM special case (ln(F/K)/  (F-K) -> 1/F as K -> F)
        f_pow = forward ** (1 - beta)
        term1 = alpha / f_pow
        term2 = 1 + ((1 - beta) ** 2 / 24 * alpha ** 2 / f_pow ** 2 + 0.25 * rho * beta * nu * alpha / f_pow + (2 - 3 * rho ** 2) / 24 * nu ** 2) * expiry
        return term1 * term2

    fk_beta = (forward * strike) ** ((1 - beta) / 2)
    log_fk = math.log(forward / strike)
    z = (nu / alpha) * fk_beta * log_fk
    x_z = math.log((math.sqrt(1 - 2 * rho * z + z ** 2) + z - rho) / (1 - rho)) if abs(z) > 1e-12 else 1.0
    z_over_xz = z / x_z if abs(z) > 1e-12 else 1.0

    denom = fk_beta * (1 + (1 - beta) ** 2 / 24 * log_fk ** 2 + (1 - beta) ** 4 / 1920 * log_fk ** 4)
    term1 = alpha / denom
    term2 = 1 + ((1 - beta) ** 2 / 24 * alpha ** 2 / fk_beta ** 2 + 0.25 * rho * beta * nu * alpha / fk_beta + (2 - 3 * rho ** 2) / 24 * nu ** 2) * expiry
    return term1 * z_over_xz * term2


class SabrCalibrateRequest(BaseModel):
    forward: float = Field(gt=0)
    expiryYears: float = Field(gt=0, le=10)
    beta: float = Field(default=0.5, ge=0, le=1)  # conventionally fixed, not calibrated (jointly unidentifiable with rho)
    strikes: List[float] = Field(min_length=3, max_length=500)
    marketVolsPct: List[float] = Field(min_length=3, max_length=500)  # market-quoted IV per strike, as %


def _fit_quality_label(rmse_vol_pts: float, model_name: str = "SABR") -> str:
    # Both SABR (3 free params) and Heston (5) are smooth models -- neither
    # can or should chase point-to-point noise. A high RMSE against a real
    # chain is an honest, correct signal that the quoted smile/surface is
    # noisy/illiquid, not a calibration failure to hide. Verified live: a
    # real AAPL chain with wide bid-ask/thin-volume strikes produced
    # ~18-26 vol pts RMSE in both models precisely because adjacent
    # strikes' quoted IVs jumped 20-40pp against each other -- no smooth
    # few-parameter model fits that, correctly.
    if rmse_vol_pts < 2:
        return "Excellent fit -- the quoted smile is smooth and well-behaved."
    if rmse_vol_pts < 5:
        return "Good fit -- typical for a real, moderately liquid options chain."
    if rmse_vol_pts < 15:
        return "Fair fit -- some strikes likely thin/stale; treat fitted vols at the noisiest strikes with caution."
    return f"Poor fit -- the quoted smile/surface is too noisy for a stable {model_name} fit, likely from illiquid/stale strikes. Consider restricting to a tighter, more liquid moneyness band."


class SabrCalibrateResponse(BaseModel):
    alpha: float
    rho: float
    nu: float
    beta: float
    calibrationRmseVolPts: float  # RMSE in vol points (e.g. 0.85 = 0.85% average miss) -- the real fit-quality number
    fitQuality: str
    fittedVolsPct: List[float]  # SABR's own vol at each input strike, for a fitted-vs-market overlay
    strikesUsed: int


def sabr_calibrate(req: SabrCalibrateRequest) -> SabrCalibrateResponse:
    strikes = np.array(req.strikes)
    market_vols = np.array(req.marketVolsPct) / 100.0
    beta = req.beta

    def residuals(params):
        alpha, rho, nu = params
        model_vols = np.array([_hagan_sabr_vol(req.forward, k, req.expiryYears, alpha, beta, rho, nu) for k in strikes])
        return model_vols - market_vols

    # Reasonable starting guess: alpha near ATM vol level (scaled for beta),
    # rho/nu near zero (no skew/vol-of-vol) -- let the optimizer find the rest.
    # Bounds scale with the data's own vol level rather than a fixed 10.0:
    # real market chains can run at genuinely high IV (short-dated/earnings/
    # meme-stock-style names), and a hardcoded bound made the initial guess
    # infeasible on a real AAPL chain during verification (median IV 65%,
    # alpha guess 11.5 > a fixed bound of 10). Found live, not a math bug.
    atm_vol_guess = float(np.median(market_vols))
    alpha_guess = atm_vol_guess * req.forward ** (1 - beta)
    alpha_upper = max(10.0, alpha_guess * 5)
    x0 = [alpha_guess, 0.0, 0.3]
    bounds = ([1e-6, -0.999, 1e-6], [alpha_upper, 0.999, alpha_upper])
    result = least_squares(residuals, x0, bounds=bounds)
    alpha, rho, nu = result.x

    fitted = np.array([_hagan_sabr_vol(req.forward, k, req.expiryYears, alpha, beta, rho, nu) for k in strikes])
    rmse = float(np.sqrt(np.mean((fitted - market_vols) ** 2)) * 100)

    return SabrCalibrateResponse(
        alpha=float(alpha), rho=float(rho), nu=float(nu), beta=beta,
        calibrationRmseVolPts=rmse, fitQuality=_fit_quality_label(rmse),
        fittedVolsPct=(fitted * 100).tolist(), strikesUsed=len(strikes),
    )


class SabrSmileRequest(BaseModel):
    forward: float = Field(gt=0)
    expiryYears: float = Field(gt=0, le=10)
    alpha: float = Field(gt=0)
    beta: float = Field(ge=0, le=1)
    rho: float = Field(ge=-0.999, le=0.999)
    nu: float = Field(gt=0)
    strikes: List[float] = Field(min_length=1, max_length=500)


class SabrSmileResponse(BaseModel):
    volsPct: List[float]


def sabr_smile(req: SabrSmileRequest) -> SabrSmileResponse:
    vols = [_hagan_sabr_vol(req.forward, k, req.expiryYears, req.alpha, req.beta, req.rho, req.nu) * 100 for k in req.strikes]
    return SabrSmileResponse(volsPct=vols)


# ─── Heston (QuantLib native calibration) ─────────────────────────────────
class HestonQuote(BaseModel):
    strike: float
    expiryYears: float = Field(gt=0, le=10)
    marketVolPct: float = Field(gt=0)


class HestonCalibrateRequest(BaseModel):
    spot: float = Field(gt=0)
    riskFreeRatePct: float
    dividendYieldPct: float = 0.0
    quotes: List[HestonQuote] = Field(min_length=5, max_length=500)
    # Initial guesses -- Heston calibration is a non-convex problem and can
    # converge to different local optima from different starting points,
    # so these are exposed rather than hardcoded silently.
    v0: float = Field(default=0.04, gt=0)
    kappa: float = Field(default=2.0, gt=0)
    theta: float = Field(default=0.04, gt=0)
    sigma: float = Field(default=0.5, gt=0)
    rho: float = Field(default=-0.5, ge=-0.999, le=0.999)


class HestonCalibrateResponse(BaseModel):
    v0: float  # initial variance
    kappa: float  # mean-reversion speed
    theta: float  # long-run variance
    sigma: float  # vol-of-vol
    rho: float  # spot-vol correlation
    calibrationRmseVolPts: float
    fitQuality: str
    fellerConditionSatisfied: bool  # 2*kappa*theta > sigma^2 -- variance process stays positive; a real, useful diagnostic
    quotesUsed: int


def _calibrate_heston_once(req: "HestonCalibrateRequest", v0: float, kappa: float, theta: float, sigma: float, rho: float):
    """One Levenberg-Marquardt run from a given starting point. Returns
    (model, helpers, rmse). Deliberately uses QuantLib's own default
    constraint (nothing passed to calibrate()) rather than a custom
    NonhomogeneousBoundaryConstraint -- verified live that an explicit
    constraint here causes LM to take zero steps and return the starting
    guess unchanged (endCriteria=3, no error, silently wrong), whereas the
    model's built-in constraint lets it actually search."""
    import QuantLib as ql

    today = ql.Date.todaysDate()
    ql.Settings.instance().evaluationDate = today
    day_count = ql.Actual365Fixed()
    calendar = ql.NullCalendar()

    spot_handle = ql.QuoteHandle(ql.SimpleQuote(req.spot))
    rate_ts = ql.YieldTermStructureHandle(ql.FlatForward(today, req.riskFreeRatePct / 100.0, day_count))
    div_ts = ql.YieldTermStructureHandle(ql.FlatForward(today, req.dividendYieldPct / 100.0, day_count))

    process = ql.HestonProcess(rate_ts, div_ts, spot_handle, v0, kappa, theta, sigma, rho)
    model = ql.HestonModel(process)
    engine = ql.AnalyticHestonEngine(model)

    helpers = []
    for q in req.quotes:
        maturity_days = max(1, int(round(q.expiryYears * 365)))
        period = ql.Period(maturity_days, ql.Days)
        vol_quote = ql.QuoteHandle(ql.SimpleQuote(q.marketVolPct / 100.0))
        helper = ql.HestonModelHelper(period, calendar, req.spot, q.strike, vol_quote, rate_ts, div_ts)
        helper.setPricingEngine(engine)
        helpers.append(helper)

    optimizer = ql.LevenbergMarquardt()
    model.calibrate(helpers, optimizer, ql.EndCriteria(1000, 100, 1e-8, 1e-8, 1e-8))

    errors = [h.calibrationError() for h in helpers]
    rmse = float(np.sqrt(np.mean(np.array(errors) ** 2)) * 100)
    return model, rmse


def heston_calibrate(req: HestonCalibrateRequest) -> HestonCalibrateResponse:
    # Heston calibration is a genuinely non-convex problem -- verified live
    # that a single LM run is sensitive to its starting point (real AAPL
    # chain: different starts converged to different, sometimes
    # Feller-violating, local optima). Multi-start (a handful of
    # economically sensible starting points, keep the lowest-RMSE result)
    # is the standard practical fix, not an exotic technique.
    atm_var_guess = (np.median([q.marketVolPct for q in req.quotes]) / 100.0) ** 2
    starting_points = [
        (atm_var_guess, 2.0, atm_var_guess, 0.5, -0.5),
        (req.v0, req.kappa, req.theta, req.sigma, req.rho),
        (atm_var_guess, 5.0, atm_var_guess, 1.0, -0.7),
        (atm_var_guess * 0.5, 1.0, atm_var_guess * 1.5, 0.3, -0.3),
    ]

    best_model, best_rmse = None, float("inf")
    for v0, kappa, theta, sigma, rho in starting_points:
        try:
            model, rmse = _calibrate_heston_once(req, v0, kappa, theta, sigma, rho)
        except RuntimeError:
            continue  # a given starting point can fail to converge at all -- skip it, not fatal
        if rmse < best_rmse:
            best_model, best_rmse = model, rmse

    if best_model is None:
        raise ValueError("Heston calibration failed to converge from every starting point tried.")

    model = best_model
    rmse = best_rmse
    # Named accessors, not positional model.params() unpacking: verified
    # live that params() returns [v0, kappa, sigma, rho, theta] -- NOT the
    # intuitive [v0, kappa, theta, sigma, rho] order -- so unpacking it
    # positionally silently swapped theta/sigma/rho's values.
    v0, kappa, theta, sigma, rho = model.v0(), model.kappa(), model.theta(), model.sigma(), model.rho()

    return HestonCalibrateResponse(
        v0=float(v0), kappa=float(kappa), theta=float(theta), sigma=float(sigma), rho=float(rho),
        calibrationRmseVolPts=rmse, fitQuality=_fit_quality_label(rmse, "Heston"),
        fellerConditionSatisfied=bool(2 * kappa * theta > sigma ** 2),
        quotesUsed=len(req.quotes),
    )


class HestonPriceRequest(BaseModel):
    spot: float = Field(gt=0)
    strike: float = Field(gt=0)
    expiryYears: float = Field(gt=0, le=10)
    riskFreeRatePct: float
    dividendYieldPct: float = 0.0
    isCall: bool = True
    v0: float = Field(gt=0)
    kappa: float = Field(gt=0)
    theta: float = Field(gt=0)
    sigma: float = Field(gt=0)
    rho: float = Field(ge=-0.999, le=0.999)


class HestonPriceResponse(BaseModel):
    price: float
    impliedVolPct: Optional[float] = None  # the Black-Scholes vol that would reproduce this Heston price -- lets it be compared directly against BSM


def heston_price(req: HestonPriceRequest) -> HestonPriceResponse:
    import QuantLib as ql

    today = ql.Date.todaysDate()
    ql.Settings.instance().evaluationDate = today
    day_count = ql.Actual365Fixed()
    calendar = ql.NullCalendar()
    maturity = calendar.advance(today, ql.Period(max(1, int(round(req.expiryYears * 365))), ql.Days))

    spot_handle = ql.QuoteHandle(ql.SimpleQuote(req.spot))
    rate_ts = ql.YieldTermStructureHandle(ql.FlatForward(today, req.riskFreeRatePct / 100.0, day_count))
    div_ts = ql.YieldTermStructureHandle(ql.FlatForward(today, req.dividendYieldPct / 100.0, day_count))

    process = ql.HestonProcess(rate_ts, div_ts, spot_handle, req.v0, req.kappa, req.theta, req.sigma, req.rho)
    model = ql.HestonModel(process)
    engine = ql.AnalyticHestonEngine(model)

    option_type = ql.Option.Call if req.isCall else ql.Option.Put
    payoff = ql.PlainVanillaPayoff(option_type, req.strike)
    exercise = ql.EuropeanExercise(maturity)
    option = ql.VanillaOption(payoff, exercise)
    option.setPricingEngine(engine)
    price = option.NPV()

    implied_vol_pct = None
    try:
        flat_vol_ts = ql.BlackVolTermStructureHandle(ql.BlackConstantVol(today, calendar, 0.2, day_count))
        bsm_process = ql.BlackScholesMertonProcess(spot_handle, div_ts, rate_ts, flat_vol_ts)
        iv = option.impliedVolatility(price, bsm_process, 1e-6, 200, 1e-4, 4.0)
        implied_vol_pct = float(iv * 100)
    except RuntimeError:
        pass  # implied vol solve can fail to converge for deep ITM/OTM prices -- price itself is still valid

    return HestonPriceResponse(price=float(price), impliedVolPct=implied_vol_pct)
