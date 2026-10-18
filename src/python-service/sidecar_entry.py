import os


def _port() -> int:
    raw = os.environ.get("PYTHON_SERVICE_PORT", "").strip()
    if not raw:
        raise SystemExit("PYTHON_SERVICE_PORT is required; the launcher chooses a per-launch loopback port.")
    try:
        port = int(raw)
    except ValueError as exc:
        raise SystemExit(f"Invalid PYTHON_SERVICE_PORT: {raw}") from exc
    if port <= 0 or port > 65535:
        raise SystemExit(f"Invalid PYTHON_SERVICE_PORT: {raw}")
    return port


def serve():
    port = _port()
    import uvicorn
    from main import app

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level=os.environ.get("LIOS_PYTHON_LOG_LEVEL", "warning"),
        access_log=False,
    )


if __name__ == "__main__":
    serve()
