"""Exit the sidecar when the process that launched it is gone.

Written for LiOS. A force-quit, crash or power loss gives the Node launcher no chance to stop its children, and
neither macOS nor Windows kills them for us. Without this, every abnormal exit leaves a Python sidecar running
(and holding a port and memory) until reboot. The launcher passes its own pid as LIOS_PARENT_PID.
"""

import os
import sys
import threading

POLL_SECONDS = 2.0
ENV_NAME = "LIOS_PARENT_PID"


def parent_is_alive(pid: int) -> bool:
    if sys.platform == "win32":
        import ctypes

        SYNCHRONIZE = 0x00100000
        WAIT_TIMEOUT = 0x00000102
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
        if not handle:
            return False
        try:
            return kernel32.WaitForSingleObject(handle, 0) == WAIT_TIMEOUT
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def watch_parent(pid: int, poll_seconds: float = POLL_SECONDS, on_orphaned=lambda: os._exit(0)) -> threading.Thread:
    """Poll `pid`; call `on_orphaned` once it is gone. The thread is a daemon and never blocks shutdown."""

    def run() -> None:
        stop = threading.Event()
        while not stop.wait(poll_seconds):
            if not parent_is_alive(pid):
                on_orphaned()
                return

    thread = threading.Thread(target=run, name="lios-parent-watchdog", daemon=True)
    thread.start()
    return thread


def start_from_environment() -> threading.Thread | None:
    raw = os.environ.get(ENV_NAME, "").strip()
    if not raw:
        return None
    try:
        pid = int(raw)
    except ValueError as exc:
        raise SystemExit(f"Invalid {ENV_NAME}: {raw}") from exc
    if pid <= 1:
        raise SystemExit(f"Invalid {ENV_NAME}: {raw}")
    if not parent_is_alive(pid):
        # The launcher died between spawning us and our start-up.
        raise SystemExit(0)
    return watch_parent(pid)
