"""One-shot canonical numerical execution, with no HTTP or host-service dependency.

Usage: python /workspace/engine_worker.py /workspace/request.json /workspace/result.json
The sandbox owns process/network/resource isolation; this entry point only accepts
an allowlisted service route and bounded finite JSON, never Python source/modules.
"""
from __future__ import annotations

import json
import os
import stat
import sys

from engine_routes import EngineInputError, EngineUnavailableError, dispatch, runtime_inventory, input_contract

MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_ERROR_CHARS = 4000


class WorkerProtocolError(ValueError):
    pass


def _reject_constant(_value):
    raise WorkerProtocolError("Non-JSON numeric constant in worker request.")


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise WorkerProtocolError("Duplicate JSON object key in worker request.")
        result[key] = value
    return result


def _read_request(path):
    before = os.lstat(path)
    if not stat.S_ISREG(before.st_mode):
        raise WorkerProtocolError("Worker request must be a regular non-symlink file.")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as source:
        opened = os.fstat(source.fileno())
        if not stat.S_ISREG(opened.st_mode) or (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
            raise WorkerProtocolError("Worker request file changed while opening.")
        if opened.st_size > MAX_JSON_BYTES:
            raise WorkerProtocolError("Worker request exceeds 8 MiB.")
        data = source.read(MAX_JSON_BYTES + 1)
    if len(data) > MAX_JSON_BYTES:
        raise WorkerProtocolError("Worker request exceeds 8 MiB.")
    request = json.loads(data.decode("utf-8"), parse_constant=_reject_constant, object_pairs_hook=_object)
    if not isinstance(request, dict) or set(request) != {"route", "body"} or not isinstance(request["route"], str):
        raise WorkerProtocolError("Expected exactly a route string and body.")
    return request


def _encode_result(result):
    # Bound the encoded result before creating any output file; nonfinite engine
    # results fail execution instead of becoming null, Infinity or partial JSON.
    encoded = bytearray()
    for chunk in json.JSONEncoder(allow_nan=False, ensure_ascii=True, separators=(",", ":")).iterencode(result):
        chunk_bytes = chunk.encode("utf-8")
        if len(encoded) + len(chunk_bytes) > MAX_JSON_BYTES:
            raise WorkerProtocolError("Worker result exceeds 8 MiB.")
        encoded.extend(chunk_bytes)
    return encoded


def run(request_path, result_path):
    request = _read_request(request_path)
    try:
        if request["route"] == "/runtime-info":
            if request["body"] != {}:
                raise EngineInputError("Runtime inventory requires an empty object body.")
            result = runtime_inventory()
        elif request["route"] == "/input-contract":
            result = input_contract(request["body"])
        else:
            result = dispatch(request["route"], request["body"]).model_dump(mode="python")
        envelope = {"ok": True, "result": result}
    except EngineInputError as exc:
        envelope = {"ok": False, "error": {"kind": "input", "message": exc.worker_message[:MAX_ERROR_CHARS]}}
    except EngineUnavailableError as exc:
        envelope = {"ok": False, "error": {"kind": "unavailable", "message": str(exc)[:MAX_ERROR_CHARS]}}
    encoded = _encode_result(envelope)
    # Fresh output only: never follow or overwrite a symlink or existing file.
    fd = os.open(result_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(encoded)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2:
        print("Usage: engine_worker.py request.json result.json", file=sys.stderr)
        return 2
    try:
        run(argv[0], argv[1])
    except Exception as exc:  # An unexpected/protocol error is never an input-success envelope.
        print(f"Numerical worker failed ({type(exc).__name__}).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
