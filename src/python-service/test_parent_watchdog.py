import os
import subprocess
import sys
import unittest
from pathlib import Path

from parent_watchdog import ENV_NAME, parent_is_alive, start_from_environment

SERVICE_DIR = Path(__file__).resolve().parent
# The child runs the real watchdog entry point; it would otherwise sleep forever.
CHILD = "from parent_watchdog import start_from_environment; import time; start_from_environment(); time.sleep(120)"


def start_sleeper() -> subprocess.Popen:
    return subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])


class ParentWatchdogTests(unittest.TestCase):
    def test_liveness_tracks_a_real_process(self):
        parent = start_sleeper()
        try:
            self.assertTrue(parent_is_alive(parent.pid))
        finally:
            parent.kill()
            parent.wait(timeout=10)
        self.assertFalse(parent_is_alive(parent.pid))

    def test_orphaned_sidecar_exits_when_its_launcher_dies(self):
        parent = start_sleeper()
        env = {**os.environ, ENV_NAME: str(parent.pid), "PYTHONPATH": str(SERVICE_DIR)}
        child = subprocess.Popen([sys.executable, "-c", CHILD], env=env, cwd=SERVICE_DIR)
        try:
            self.assertIsNone(child.poll(), "the sidecar must be running while its launcher is alive")
            parent.kill()
            parent.wait(timeout=10)
            # The watchdog polls every couple of seconds; wait on the child's real exit, not a fixed sleep.
            self.assertEqual(child.wait(timeout=20), 0)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=10)
            if parent.poll() is None:
                parent.kill()
                parent.wait(timeout=10)

    def test_unset_variable_means_no_watchdog(self):
        saved = os.environ.pop(ENV_NAME, None)
        try:
            self.assertIsNone(start_from_environment())
        finally:
            if saved is not None:
                os.environ[ENV_NAME] = saved

    def test_invalid_pid_is_rejected(self):
        for raw in ("abc", "0", "1", "-5"):
            os.environ[ENV_NAME] = raw
            try:
                with self.assertRaises(SystemExit):
                    start_from_environment()
            finally:
                del os.environ[ENV_NAME]


if __name__ == "__main__":
    unittest.main()
