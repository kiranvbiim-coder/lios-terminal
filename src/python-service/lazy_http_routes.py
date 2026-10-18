"""FastAPI transport adapter; numerical packs load only on execution or schema access."""
from typing import Any

from fastapi import Body, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from fastapi.routing import APIRoute

from engine_routes import (
    EngineInputError,
    EngineUnavailableError,
    dispatch,
    resolve_route,
)


def _endpoint(route_path):
    def endpoint(payload: Any = Body(...)):
        try:
            return dispatch(route_path, payload)
        except EngineInputError as exc:
            if exc.validation_errors is not None:
                errors = [
                    {**error, "loc": ("body", *error["loc"])}
                    for error in exc.validation_errors
                ]
                raise RequestValidationError(errors, body=payload) from exc
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except EngineUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    return endpoint


def add_engine_routes(router, routes, *, prefix=""):
    for route in routes:
        endpoint = _endpoint(f"{prefix}{route.path}")
        endpoint.__name__ = f"engine_{route.function}"
        router.add_api_route(route.path, endpoint, methods=["POST"])


def install_lazy_openapi(app, routes_by_path):
    def openapi():
        if app.openapi_schema is not None:
            return app.openapi_schema
        schema_routes = []
        for http_route in app.routes:
            declaration = routes_by_path.get(getattr(http_route, "path", None))
            if declaration is None or not isinstance(http_route, APIRoute):
                schema_routes.append(http_route)
                continue
            try:
                request_model, response_model, _ = resolve_route(declaration)
            except EngineUnavailableError:
                # Keep the known path visible, without inventing a typed schema
                # for a pack absent from this runtime. Execution returns 503.
                http_route.responses[503] = {"description": "Required numerical pack unavailable"}
                schema_routes.append(http_route)
                continue

            def schema_endpoint(payload):
                raise AssertionError("Schema-only endpoint cannot execute")

            schema_endpoint.__annotations__ = {"payload": request_model, "return": response_model}
            schema_routes.append(APIRoute(
                http_route.path,
                schema_endpoint,
                name=http_route.name,
                methods=["POST"],
                tags=http_route.tags,
                response_model=response_model,
                responses={503: {"description": "Required numerical pack unavailable"}},
            ))
        app.openapi_schema = get_openapi(
            title=app.title, version=app.version, description=app.description,
            routes=schema_routes,
        )
        return app.openapi_schema

    app.openapi = openapi
