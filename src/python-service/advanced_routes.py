"""Lazy HTTP registration for the canonical institutional numerical routes."""
from fastapi import APIRouter

from engine_routes import ADVANCED_ROUTES
from lazy_http_routes import add_engine_routes

ROUTES = ADVANCED_ROUTES
router = APIRouter(prefix="/advanced", tags=["institutional-quant"])
# Dispatch uses complete service paths; APIRouter supplies the HTTP prefix.
add_engine_routes(router, ROUTES, prefix="/advanced")
