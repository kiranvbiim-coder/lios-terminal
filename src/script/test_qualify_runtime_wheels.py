import hashlib
from pathlib import Path
import tempfile
import unittest
import zipfile
from qualify_runtime_wheels import lock_records, wheel_record


class WheelClosureTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)

    def wheel(self, filename, name="Example", version="1.2.3"):
        file = self.root / filename
        with zipfile.ZipFile(file, "w") as archive:
            archive.writestr("example-1.2.3.dist-info/METADATA", f"Name: {name}\nVersion: {version}\n")
        return file

    def test_exact_metadata_and_actual_bytes_bind_lock(self):
        file = self.wheel("example.whl", name="Example_Package")
        record = wheel_record(file)
        self.assertEqual(record["name"], "example-package")
        self.assertEqual(record["version"], "1.2.3")
        self.assertEqual(record["sha256"], hashlib.sha256(file.read_bytes()).hexdigest())
        with zipfile.ZipFile(file, "a") as archive:
            archive.writestr("example/data.txt", "changed payload")
        self.assertNotEqual(wheel_record(file)["sha256"], record["sha256"])

    def test_multiple_versions_of_distribution_refuse_closure(self):
        self.wheel("one.whl")
        self.wheel("two.whl", version="2.0.0")
        with self.assertRaisesRegex(ValueError, "exactly one wheel"):
            lock_records(self.root)

    def test_ambiguous_metadata_refuses_lock(self):
        file = self.wheel("example.whl")
        with zipfile.ZipFile(file, "a") as archive:
            archive.writestr("other.dist-info/METADATA", "Name: Other\nVersion: 1.0\n")
        with self.assertRaisesRegex(ValueError, "exactly one distribution"):
            wheel_record(file)

    def test_sources_and_symlinks_cannot_be_published_as_wheels(self):
        file = self.wheel("source.zip")
        with self.assertRaisesRegex(ValueError, "regular wheel"):
            wheel_record(file)
        link = self.root / "linked.whl"
        link.symlink_to(file)
        with self.assertRaisesRegex(ValueError, "regular wheel"):
            wheel_record(link)


if __name__ == "__main__":
    unittest.main()
