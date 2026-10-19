"""Focused release-builder contracts; no network, pip install, or native execution."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import build_native_runtime_bundle as builder


class NativeBundleBuilderTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def archive(self, entries):
        path = self.root / "fixture.tar.gz"
        with tarfile.open(path, "w:gz") as archive:
            for name, kind, value in entries:
                item = tarfile.TarInfo(name)
                item.mode = 0o755 if name.endswith("python3.13") else 0o644
                if kind == "file":
                    item.size = len(value)
                    archive.addfile(item, io.BytesIO(value))
                else:
                    item.type = {"symlink": tarfile.SYMTYPE, "hardlink": tarfile.LNKTYPE,
                                 "fifo": tarfile.FIFOTYPE, "directory": tarfile.DIRTYPE}[kind]
                    if kind in {"symlink", "hardlink"}:
                        item.linkname = value
                    archive.addfile(item)
        return path

    def extract(self, entries):
        destination = self.root / "extracted"
        destination.mkdir()
        return builder.extract_archive(self.archive(entries), destination)

    def core_lock(self):
        version, roots = builder.core_manifest()
        pins = {name: {"2.x": "2.2.6", "<3.0": "2.3.3"}.get(spec, spec)
                for name, spec in roots.items()}
        data = "".join(f"{name}=={pin} --hash=sha256:{'a' * 64}\n"
                       for name, pin in pins.items()).encode()
        return version, roots, pins, data

    def test_host_gate_precedes_argument_or_input_work(self):
        with patch.object(builder.sys, "platform", "linux"), patch.object(builder, "core_manifest") as manifest:
            with self.assertRaisesRegex(ValueError, "actual darwin-arm64"):
                builder.main()
            manifest.assert_not_called()
        with patch.object(builder.sys, "platform", "darwin"), patch.object(builder.platform, "machine", return_value="x86_64"):
            with self.assertRaises(ValueError):
                builder.require_target_host()
        with patch.object(builder.sys, "platform", "darwin"), patch.object(builder.platform, "machine", return_value="arm64"):
            for release in ("22.6.0", "unknown"):
                with patch.object(builder.platform, "release", return_value=release):
                    with self.assertRaisesRegex(ValueError, "macOS 14.0"):
                        builder.require_target_host()
            with patch.object(builder.platform, "release", return_value="23.0.0"):
                builder.require_target_host()

    def test_lock_has_only_exact_core_hash_pins_and_manifest_roots(self):
        version, roots, pins, data = self.core_lock()
        self.assertEqual(version, "1.1.0")
        self.assertEqual(builder.parse_lock(data, roots), pins)
        bad_lines = [b"-r other.txt", b"--index-url https://attacker.invalid",
                     b"numpy @ https://attacker.invalid/wheel.whl", b"numpy>=2",
                     b"numpy==2.2.6", b"numpy[extra]==2.2.6 --hash=sha256:" + b"a" * 64,
                     b"QuantLib==1.43 --hash=sha256:" + b"a" * 64]
        for bad in bad_lines:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                builder.parse_lock(data + bad + b"\n", roots)
        with self.assertRaises(ValueError):
            builder.parse_lock(data + data, roots)
        with self.assertRaises(ValueError):
            builder.parse_lock(data.replace(b"2.2.6", b"3.0.0"), roots)
        with self.assertRaises(ValueError):
            builder.parse_lock(b"", roots)

    def test_archive_digest_is_checked_against_selected_release_before_extract(self):
        source = self.root / "archive"
        source.write_bytes(b"owned bytes")
        destination = self.root / "snapshot"
        with self.assertRaisesRegex(ValueError, "selected CPython"):
            builder.snapshot_archive(source, destination, "a" * 64)
        self.assertFalse(destination.exists())
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        with patch.object(builder, "ARCHIVE_SHA256", digest):
            builder.snapshot_archive(source, destination, digest)
        self.assertEqual(destination.read_bytes(), b"owned bytes")
        source.unlink()
        source.symlink_to(destination)
        with patch.object(builder, "ARCHIVE_SHA256", digest), self.assertRaises(OSError):
            builder.snapshot_archive(source, self.root / "second", digest)

    def test_paths_links_and_special_files_fail_closed(self):
        for path in ("/python/x", "python/../x", "python//x", "python/./x", "other/x", "python\\x"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                builder.archive_path(path)
        for target in ("../../outside", "/outside", "..\\outside"):
            with self.subTest(target=target), self.assertRaises(ValueError):
                builder.link_destination(builder.archive_path("python/bin/link"), target)
        with self.assertRaises(ValueError):
            self.extract([("python/fifo", "fifo", "")])

    def test_archive_refuses_duplicates_and_link_parent_traversal(self):
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            self.extract([("python/file", "file", b"a"), ("python/file", "file", b"b")])
        # Use another owned extraction directory after the refusal.
        with tempfile.TemporaryDirectory(dir=self.root) as destination:
            archive = self.archive([("python/bin", "symlink", "lib"),
                                    ("python/bin/child", "file", b"bad")])
            with self.assertRaisesRegex(ValueError, "non-directory"):
                builder.extract_archive(archive, Path(destination))

    def test_materialization_preserves_legal_tree_and_removes_only_unused_wrappers_caches(self):
        source = self.extract([
            ("python/bin/python3.13", "file", b"native executable bytes"),
            ("python/bin/python3", "symlink", "python3.13"),
            ("python/bin/pip", "file", b"#!/absolute/staging/python\nimport pip\n"),
            ("python/lib/python3.13/LICENSE.txt", "file", b"full PSF license"),
            ("python/lib/component/COPYING", "file", b"full component copyright"),
            ("python/lib/component/__pycache__/cache.pyc", "file", b"cache"),
            ("python/lib/component/link", "symlink", "COPYING"),
            ("python/lib/component/hardcopy", "hardlink", "python/lib/component/COPYING"),
        ])
        runtime = self.root / "runtime"
        builder.materialize_runtime(source, runtime)
        self.assertEqual((runtime / "bin/python3").read_bytes(), b"native executable bytes")
        self.assertTrue((runtime / "bin/python3").stat().st_mode & 0o111)
        self.assertFalse((runtime / "bin/python3").is_symlink())
        self.assertEqual((runtime / "lib/component/COPYING").read_bytes(), b"full component copyright")
        self.assertEqual((runtime / "lib/component/link").read_bytes(), b"full component copyright")
        self.assertFalse((runtime / "bin/pip").exists())
        self.assertFalse((runtime / "lib/component/__pycache__").exists())
        changes = json.loads((runtime / "lios-build-changes.json").read_bytes())
        self.assertEqual(changes["removedConsoleLaunchers"], ["bin/pip"])
        files, total = builder.hash_files(runtime)
        self.assertEqual(total, sum(record["size"] for record in files))
        for record in files:
            payload = runtime / record["path"]
            self.assertEqual(record["sha256"], hashlib.sha256(payload.read_bytes()).hexdigest())
            self.assertFalse(payload.is_symlink())

    def test_payload_bounds_and_unresolved_or_escaping_links_are_refused(self):
        with patch.object(builder, "MAX_FILE", 1), self.assertRaisesRegex(ValueError, "size limit"):
            self.extract([("python/file", "file", b"ab")])
        with tempfile.TemporaryDirectory(dir=self.root) as destination:
            archive = self.archive([("python/link", "hardlink", "other/file")])
            with self.assertRaisesRegex(ValueError, "escapes"):
                builder.extract_archive(archive, Path(destination))
        with tempfile.TemporaryDirectory(dir=self.root) as destination:
            archive = self.archive([("python/link", "symlink", "missing")])
            with self.assertRaises(FileNotFoundError):
                builder.extract_archive(archive, Path(destination))

    def legal_fixture(self):
        directory = self.root / "legal"
        (directory / "licenses").mkdir(parents=True)
        payloads = {
            "PYTHON.json": json.dumps({"python_version": builder.PYTHON_VERSION,
                                       "target_triple": "aarch64-apple-darwin"}).encode(),
            "licenses/LICENSE.cpython.txt": b"complete CPython grant",
            "licenses/LICENSE.component.txt": b"complete component terms",
        }
        records = []
        for path, data in payloads.items():
            (directory / path).write_bytes(data)
            records.append({"path": path, "size": len(data),
                            "sha256": hashlib.sha256(data).hexdigest()})
        manifest = self.root / "legal-manifest.json"
        manifest.write_bytes(json.dumps({
            "schemaVersion": 1, "source": {"repository": builder.SOURCE_REPOSITORY,
                "commit": builder.SOURCE_COMMIT, "archiveSha256": builder.FULL_ARCHIVE_SHA256},
            "files": records,
        }).encode())
        return directory, manifest, hashlib.sha256(manifest.read_bytes()).hexdigest(), payloads

    def test_legal_snapshot_is_digest_anchored_and_copied_without_reinterpretation(self):
        directory, manifest, digest, expected = self.legal_fixture()
        with self.assertRaisesRegex(ValueError, "approved companion"):
            builder.legal_snapshot(directory, manifest)
        with patch.object(builder, "LEGAL_MANIFEST_SHA256", digest):
            payloads, raw = builder.legal_snapshot(directory, manifest)
        self.assertEqual(payloads, expected)
        runtime = self.root / "runtime"
        runtime.mkdir()
        builder.retain_legal_snapshot(runtime, payloads, raw)
        retained = runtime / "legal/python-build-standalone"
        for path, data in expected.items():
            self.assertEqual((retained / path).read_bytes(), data)
        self.assertEqual((retained / "legal-manifest.json").read_bytes(), manifest.read_bytes())

    def test_legal_snapshot_refuses_missing_extra_tampered_and_linked_payloads(self):
        directory, manifest, digest, expected = self.legal_fixture()
        license_path = directory / "licenses/LICENSE.component.txt"
        with patch.object(builder, "LEGAL_MANIFEST_SHA256", digest):
            license_path.unlink()
            with self.assertRaisesRegex(ValueError, "missing or unlisted"):
                builder.legal_snapshot(directory, manifest)
            license_path.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "approved hash"):
                builder.legal_snapshot(directory, manifest)
            license_path.unlink()
            license_path.symlink_to(directory / "licenses/LICENSE.cpython.txt")
            with self.assertRaisesRegex(ValueError, "linked or special"):
                builder.legal_snapshot(directory, manifest)
            license_path.unlink()
            license_path.write_bytes(expected["licenses/LICENSE.component.txt"])
            (directory / "unlisted.txt").write_bytes(b"extra")
            with self.assertRaisesRegex(ValueError, "missing or unlisted"):
                builder.legal_snapshot(directory, manifest)

    def test_signing_inventory_hashes_signed_bytes_only_after_each_verification(self):
        runtime = self.root / "runtime"
        runtime.mkdir()
        paths = [runtime / "python3", runtime / "native.so"]
        for path in paths:
            path.write_bytes(b"\xcf\xfa\xed\xfe" + path.name.encode())
        (runtime / "LICENSE.txt").write_bytes(b"legal text")
        events = []

        def sign_bytes(command, **kwargs):
            self.assertEqual(command[0], "/usr/bin/codesign")
            self.assertTrue(kwargs["check"])
            path = Path(command[-1])
            if "--force" in command:
                path.write_bytes(path.read_bytes() + b"-signed")
                events.append(("sign", path))
            else:
                self.assertEqual(command[1:-1], ["--verify", "--strict", "--verbose=2"])
                self.assertTrue(path.read_bytes().endswith(b"-signed"))
                events.append(("verify", path))

        original_hash = builder.hash_files

        def hash_after_verification(root):
            self.assertEqual(events, [(action, path) for path in sorted(paths)
                                     for action in ("sign", "verify")])
            return original_hash(root)

        with patch.object(builder, "hash_files", side_effect=hash_after_verification):
            records, total = builder.sign_and_inventory(runtime, "-", self.root, {}, sign_bytes)
        self.assertEqual(total, sum(record["size"] for record in records))
        for record in records:
            self.assertEqual(record["sha256"],
                             hashlib.sha256((runtime / record["path"]).read_bytes()).hexdigest())
        self.assertEqual((runtime / "LICENSE.txt").read_bytes(), b"legal text")

    def test_signing_failure_prevents_inventory_and_release_identity_uses_timestamp(self):
        runtime = self.root / "runtime"
        runtime.mkdir()
        (runtime / "python3").write_bytes(b"\xcf\xfa\xed\xfenative")
        identity = "Developer ID Application: Release Owner (TEAM)"

        def reject_verification(command, **kwargs):
            if "--force" in command:
                self.assertEqual(command[3], identity)
                self.assertIn("--timestamp", command)
                self.assertNotIn("--timestamp=none", command)
            else:
                raise subprocess.CalledProcessError(1, command)

        with patch.object(builder, "hash_files") as inventory:
            with self.assertRaises(subprocess.CalledProcessError):
                builder.sign_and_inventory(runtime, identity, self.root, {}, reject_verification)
            inventory.assert_not_called()
        for invalid in ("", "--sign", "bad\nidentity"):
            with self.assertRaisesRegex(ValueError, "identity"):
                builder.sign_and_inventory(runtime, invalid, self.root, {}, reject_verification)

    @unittest.skipUnless(sys.platform == "darwin", "Darwin atomic RENAME_EXCL")
    def test_publish_is_atomic_and_does_not_replace_even_empty_output(self):
        staging, output = self.root / "staging", self.root / "output"
        staging.mkdir()
        (staging / "manifest.json").write_bytes(b"manifest")
        output.mkdir()
        with self.assertRaises(OSError):
            builder.publish_new_directory(staging, output)
        self.assertTrue(staging.is_dir())
        self.assertEqual(list(output.iterdir()), [])
        output.rmdir()
        builder.publish_new_directory(staging, output)
        self.assertFalse(staging.exists())
        self.assertEqual((output / "manifest.json").read_bytes(), b"manifest")


if __name__ == "__main__":
    unittest.main()
