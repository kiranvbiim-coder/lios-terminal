"""Limuria Python sidecar: authenticated HTTP over canonical numerical dispatch.

Node owns auth, routing and metering. Numerical modules load only when their
route is executed (or authenticated OpenAPI schemas are explicitly requested),
so liveness does not import every unrelated optional numerical pack.
"""
import platform
from importlib.metadata import PackageNotFoundError, version

from fastapi import FastAPI, Body, HTTPException

from engine_routes import BASE_ROUTES, ADVANCED_ROUTES, ROUTES_BY_PATH, input_contract, EngineInputError, EngineUnavailableError
from lazy_http_routes import add_engine_routes, install_lazy_openapi
from parent_watchdog import start_from_environment as start_parent_watchdog
from sidecar_auth import SidecarTokenMiddleware, load_token

# Fail closed before serving any routes, including documentation.
_SIDECAR_TOKEN = load_token()
start_parent_watchdog()

app = FastAPI(title="Limuria Python Sidecar")
add_engine_routes(app, ADVANCED_ROUTES, prefix="/advanced", mount_prefix="/advanced")
app.add_middleware(SidecarTokenMiddleware, token=_SIDECAR_TOKEN)


@app.get("/health")
def health():
    # Unauthenticated liveness only, not a claim that every optional pack exists.
    return {"ok": True}


@app.get("/runtime-info")
def runtime_info():
    packages = {}
    for package in ["fastapi", "uvicorn", "numpy", "scipy", "statsmodels", "pandas", "linearmodels", "QuantLib", "arch", "ruptures", "scikit-learn", "networkx", "pymoo", "SALib", "asteval", "edgartools", "yfinance"]:
        try:
            packages[package] = version(package)
        except PackageNotFoundError:
            packages[package] = "unavailable"
    return {"ok": True, "python": platform.python_version(), "packages": packages}


@app.post("/input-contract")
def numerical_input_contract(body: dict = Body(...)):
    try:
        return input_contract(body)
    except EngineInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except EngineUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


add_engine_routes(app, BASE_ROUTES)
install_lazy_openapi(app, ROUTES_BY_PATH)
