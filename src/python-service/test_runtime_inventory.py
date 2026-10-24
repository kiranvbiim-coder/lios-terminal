"""Strict numerical Doctor inventory must expose the real mandatory pack names.

This is passive metadata only: successful execution requires separate image
and real isolated valuation acceptance tests.
"""
import unittest
from unittest.mock import patch

import engine_routes


class RuntimeInventoryTests(unittest.TestCase):
    def test_required_numerical_packages_are_reported_without_importing_engines(self):
        with patch.object(engine_routes.importlib, "import_module",
                          side_effect=AssertionError("engine imported by passive inventory")):
            info = engine_routes.runtime_inventory()
        self.assertTrue(info["ok"])
        self.assertTrue(info["python"])
        for name in ("numpy", "scipy", "pydantic"):
            with self.subTest(name=name):
                self.assertIn(name, info["packages"])
                self.assertIsInstance(info["packages"][name], str)

    def test_missing_required_package_is_explicitly_unavailable_not_omitted(self):
        from importlib.metadata import PackageNotFoundError

        def report(name):
            if name == "scipy":
                raise PackageNotFoundError(name)
            return "1.0.0"

        with patch("importlib.metadata.version", side_effect=report):
            info = engine_routes.runtime_inventory()
        self.assertEqual(info["packages"]["scipy"], "unavailable")
        self.assertEqual(info["packages"]["pydantic"], "1.0.0")


if __name__ == "__main__":
    unittest.main()
