"""Release-build-only native CPython bundle; never called by a customer installer.

Uses the selected python-build-standalone archive as data (no upstream build
scripts). Preserves its complete component/legal tree except bytecode caches
and unused bin/ script launchers: callers use the relocated python -m entrypoint.
The generated release.json is a build output, not a signature or redistribution
approval. Release packaging must separately anchor its manifest digest.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile


SOURCE_REPOSITORY = "https://github.com/astral-sh/python-build-standalone"
SOURCE_COMMIT = "9e40cba825ca0997a01cab9f60a0b15ffb976af2"
ARCHIVE_SHA256 = "ca0e6a70fb75a0984751bd75493e3de77680aef7fbd0fea9b903c299537b3423"
LEGAL_MANIFEST_SHA256 = "e72c3b19fbaf95519e4f1447fc0b24e652cbd73bcbe065d0636d892eb4538830"
FULL_ARCHIVE_SHA256 = "3497822d8bf4884bc79258f62668f985654d03d40ec74da4ca9ae7a5667c4362"
PYTHON_VERSION = "3.13.16"
MAX_METADATA = 8 * 1024 * 1024
MAX_FILES = 100000
MAX_TOTAL = 2 * 1024 * 1024 * 1024
MAX_FILE = 512 * 1024 * 1024
CHUNK = 1024 * 1024
BOOTSTRAP = {"pip", "setuptools", "wheel"}
# Release-approved core dependency names only. Exact transitive pins and wheel
# hashes come from the supplied qualified core lock, never a requirements URL.
CORE_CLOSURE = {
    "annotated-doc", "annotated-types", "anyio", "click", "fastapi", "h11",
    "idna", "numpy", "packaging", "pandas", "patsy", "pydantic",
    "pydantic-core", "python-dateutil", "pytz", "scipy", "six",
    "starlette", "statsmodels", "typing-extensions", "typing-inspection",
    "tzdata", "uvicorn",
}


def require_target_host():
    if sys.platform != "darwin" or platform.machine().lower() != "arm64":
        raise ValueError("Native bundle builds require an actual darwin-arm64 host")
    kernel = platform.release().split(".", 1)[0]
    if not kernel.isdecimal() or int(kernel) < 23:
        raise ValueError("Selected core native wheels require macOS 14.0 or newer")


def canonical_name(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def file_identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def read_regular(path, maximum):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            raise ValueError(f"Not a bounded regular input: {path}")
        data = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        if len(data) > maximum or file_identity(before) != file_identity(after):
            raise ValueError(f"Input changed while reading: {path}")
        return data


def core_manifest():
    source = Path(__file__).resolve().parents[1] / "server" / "runtimeManifest.ts"
    text = read_regular(source, MAX_METADATA).decode("utf-8")
    version = re.search(r'manifestVersion:\s*"([^"]+)"', text)
    core = re.search(r'id:\s*"core",.*?packages:\s*\[(.*?)\]', text, re.S)
    if not version or not core:
        raise ValueError("Cannot read the canonical core runtime manifest")
    specs = dict(re.findall(r'name:\s*"([^"]+)",\s*version:\s*"([^"]+)"', core[1]))
    if set(specs) != {"fastapi", "starlette", "uvicorn", "numpy", "pandas", "scipy", "statsmodels"}:
        raise ValueError("Canonical core changed; review this release builder before use")
    return version[1], specs


def parse_lock(data, specs):
    if len(data) > MAX_METADATA:
        raise ValueError("Core wheel lock exceeds metadata limit")
    pins = {}
    for line in data.decode("utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.fullmatch(
            r"([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9][A-Za-z0-9.!+_-]*)"
            r"((?:[ \t]+--hash=sha256:[0-9a-f]{64})+)[ \t]*", line)
        if not match:
            raise ValueError("Core lock permits only exact pins with SHA-256 wheel hashes")
        name, version = canonical_name(match[1]), match[2]
        if name not in CORE_CLOSURE or name in pins:
            raise ValueError(f"Unapproved or duplicate core distribution: {name}")
        pins[name] = version
    if not set(specs).issubset(pins):
        raise ValueError("Core lock is missing a canonical core root")
    # The manifest currently has only these two deliberately ranged roots.
    for name, specification in specs.items():
        if specification == "2.x":
            valid = re.fullmatch(r"2\.[0-9]+(?:\.[0-9]+)?", pins[name]) is not None
        elif specification == "<3.0":
            valid = re.fullmatch(r"[12]\.[0-9]+(?:\.[0-9]+)?", pins[name]) is not None
        else:
            valid = pins[name] == specification
        if not valid:
            raise ValueError(f"Core lock differs from canonical {name} specification")
    return pins


def snapshot_archive(source, destination, expected):
    if expected != ARCHIVE_SHA256:
        raise ValueError("Archive digest is not the selected CPython release digest")
    digest = hashlib.sha256()
    with os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW), "rb") as incoming:
        before = os.fstat(incoming.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_FILE:
            raise ValueError("CPython archive must be a bounded regular file")
        with destination.open("xb") as outgoing:
            count = 0
            while chunk := incoming.read(CHUNK):
                count += len(chunk)
                if count > MAX_FILE:
                    raise ValueError("CPython archive exceeds size limit")
                digest.update(chunk)
                outgoing.write(chunk)
        if file_identity(before) != file_identity(os.fstat(incoming.fileno())) or digest.hexdigest() != expected:
            raise ValueError("CPython archive changed or failed the pinned SHA-256 check")


def archive_path(name, directory=False):
    if directory:
        name = name.rstrip("/")
    parts = name.split("/")
    if (not name or "\\" in name or "\x00" in name or name.startswith("/")
            or any(part in {"", ".", ".."} for part in parts)
            or parts[0] != "python" or len(name.encode("utf-8")) > 4096):
        raise ValueError(f"Unsafe CPython archive path: {name!r}")
    return PurePosixPath(name)


def link_destination(path, name, hardlink=False):
    if not name or name.startswith("/") or "\\" in name or "\x00" in name:
        raise ValueError("Unsafe archive link target")
    parts = [] if hardlink else list(path.parent.parts)
    for part in name.split("/"):
        if part == "..":
            if len(parts) <= 1:
                raise ValueError("Archive link escapes Python root")
            parts.pop()
        elif part not in {"", "."}:
            parts.append(part)
    if not parts or parts[0] != "python":
        raise ValueError("Archive link escapes Python root")
    return PurePosixPath(*parts)


def extract_archive(archive_pathname, destination):
    """Do not delegate containment or filesystem writes to tarfile.extractall."""
    with tarfile.open(archive_pathname, mode="r:gz") as archive:
        members = {}
        total = 0
        for member in archive:
            path = archive_path(member.name, member.isdir())
            if path in members or len(members) >= MAX_FILES:
                raise ValueError("Duplicate archive path or too many archive entries")
            if not (member.isdir() or member.isfile() or member.issym() or member.islnk()):
                raise ValueError("Special archive entries are forbidden")
            if member.size < 0 or member.size > MAX_FILE:
                raise ValueError("Archive member exceeds size limit")
            total += member.size
            if total > MAX_TOTAL:
                raise ValueError("Archive exceeds expanded size limit")
            members[path] = member
        for path, member in members.items():
            if any(parent in members and not members[parent].isdir() for parent in path.parents):
                raise ValueError("Archive path descends through a non-directory")
            if member.issym() or member.islnk():
                link_destination(path, member.linkname, member.islnk())
        for path, member in members.items():
            target = destination.joinpath(*path.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            if member.isdir():
                target.mkdir(exist_ok=True)
            elif member.isfile():
                stream = archive.extractfile(member)
                if stream is None:
                    raise ValueError("Missing archive payload")
                with stream, target.open("xb") as output:
                    remaining = member.size
                    while remaining:
                        chunk = stream.read(min(CHUNK, remaining))
                        if not chunk:
                            raise ValueError("Truncated archive payload")
                        output.write(chunk)
                        remaining -= len(chunk)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
        # Hardlinks are materialized as regular files, not inode aliases.
        def regular_target(path, seen):
            if path in seen or path not in members:
                raise ValueError("Cyclic or missing hardlink target")
            member = members[path]
            if member.isfile():
                return destination.joinpath(*path.parts)
            if member.islnk():
                return regular_target(link_destination(path, member.linkname, True), seen | {path})
            raise ValueError("Hardlink target must be a regular archive member")
        for path, member in members.items():
            if member.islnk():
                source = regular_target(path, set())
                total += source.stat().st_size
                if total > MAX_TOTAL:
                    raise ValueError("Hardlink materialization exceeds expanded size limit")
                shutil.copyfile(source, destination.joinpath(*path.parts))
                destination.joinpath(*path.parts).chmod(stat.S_IMODE(source.stat().st_mode))
        for path, member in members.items():
            if member.issym():
                destination.joinpath(*path.parts).symlink_to(member.linkname)
        root = (destination / "python").resolve(strict=True)
        for path, member in members.items():
            if member.issym():
                resolved = destination.joinpath(*path.parts).resolve(strict=True)
                if not resolved.is_relative_to(root):
                    raise ValueError("Resolved archive symlink escapes Python root")
    return root


def build_environment(scratch):
    for name in ("home", "tmp"):
        (scratch / name).mkdir()
    return {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": str(scratch / "home"),
            "TMPDIR": str(scratch / "tmp"), "LANG": "en_US.UTF-8",
            "PIP_CONFIG_FILE": os.devnull, "PIP_DISABLE_PIP_VERSION_CHECK": "1"}


def run_python(python, args, scratch, environment, capture=False):
    return subprocess.run([str(python), "-I", "-B", *args], check=True,
                          cwd=scratch, env=environment, timeout=1800,
                          stdout=subprocess.PIPE if capture else None, text=True).stdout


INVENTORY_CODE = r'''
import importlib.metadata as metadata, json, platform, sys
from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.markers import default_environment
from pip._vendor.packaging.utils import canonicalize_name
roots = json.loads(sys.argv[1])
distributions = {}
for distribution in metadata.distributions():
    name = canonicalize_name(distribution.metadata['Name'])
    if name in distributions:
        raise ValueError('Duplicate installed distribution: ' + name)
    distributions[name] = distribution
closure, pending = set(), list(roots)
environment = default_environment()
environment['extra'] = ''
while pending:
    name = pending.pop()
    if name in closure:
        continue
    closure.add(name)
    distribution = distributions[name]
    for raw in distribution.requires or []:
        requirement = Requirement(raw)
        if requirement.marker is None or requirement.marker.evaluate(environment):
            if requirement.url or requirement.extras:
                raise ValueError('Core dependency URLs/extras need explicit release review')
            dependency = canonicalize_name(requirement.name)
            if dependency not in distributions or not requirement.specifier.contains(distributions[dependency].version):
                raise ValueError('Unsatisfied core dependency: ' + raw)
            pending.append(dependency)
print(json.dumps({'version': platform.python_version(), 'platform': sys.platform,
                  'machine': platform.machine(), 'closure': sorted(closure),
                  'packages': {name: distribution.version for name, distribution in distributions.items()}}))
'''


def inventory(python, roots, scratch, environment):
    result = json.loads(run_python(python, ["-c", INVENTORY_CODE, json.dumps(sorted(roots))],
                                   scratch, environment, capture=True))
    if (result["version"] != PYTHON_VERSION or result["platform"] != "darwin"
            or result["machine"].lower() != "arm64"):
        raise ValueError("Archive interpreter is not the selected native CPython")
    return result


def legal_snapshot(directory, manifest_path):
    """Snapshot the release-approved companion metadata and complete licenses."""
    raw = read_regular(manifest_path, MAX_METADATA)
    if hashlib.sha256(raw).hexdigest() != LEGAL_MANIFEST_SHA256:
        raise ValueError("Legal manifest is not the approved companion archive snapshot")
    manifest = json.loads(raw)
    source = {"repository": SOURCE_REPOSITORY, "commit": SOURCE_COMMIT,
              "archiveSha256": FULL_ARCHIVE_SHA256}
    if (set(manifest) != {"schemaVersion", "source", "files"}
            or manifest["schemaVersion"] != 1 or manifest["source"] != source
            or not isinstance(manifest["files"], list)
            or not 2 <= len(manifest["files"]) <= MAX_FILES):
        raise ValueError("Invalid legal manifest provenance or inventory")
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Legal directory must be a regular local directory")
    expected, total = {}, 0
    for record in manifest["files"]:
        if not isinstance(record, dict) or set(record) != {"path", "size", "sha256"}:
            raise ValueError("Invalid legal inventory record")
        path = record["path"]
        if (not isinstance(path, str)
                or (path != "PYTHON.json" and not re.fullmatch(r"licenses/[A-Za-z0-9._-]+", path))
                or path in expected or type(record["size"]) is not int
                or not 0 <= record["size"] <= MAX_METADATA
                or not isinstance(record["sha256"], str)
                or re.fullmatch(r"[0-9a-f]{64}", record["sha256"]) is None):
            raise ValueError("Unsafe legal inventory record")
        expected[path] = record
    if "PYTHON.json" not in expected or "licenses/LICENSE.cpython.txt" not in expected:
        raise ValueError("Legal snapshot lacks CPython metadata or license")
    actual = set()
    for parent, directories, names in os.walk(directory, followlinks=False):
        for name in directories:
            path = Path(parent) / name
            if path.is_symlink() or path.relative_to(directory).as_posix() != "licenses":
                raise ValueError("Legal snapshot has an unlisted or linked directory")
        for name in names:
            path = Path(parent) / name
            if not stat.S_ISREG(path.lstat().st_mode):
                raise ValueError("Legal snapshot contains a linked or special file")
            actual.add(path.relative_to(directory).as_posix())
    if actual != set(expected):
        raise ValueError("Legal snapshot has missing or unlisted files")
    payloads = {}
    for path, record in expected.items():
        data = read_regular(directory / path, MAX_METADATA)
        total += len(data)
        if (total > MAX_METADATA or len(data) != record["size"]
                or hashlib.sha256(data).hexdigest() != record["sha256"]):
            raise ValueError("Legal snapshot file failed its approved hash or byte bound")
        payloads[path] = data
    metadata = json.loads(payloads["PYTHON.json"])
    if (metadata.get("python_version") != PYTHON_VERSION
            or metadata.get("target_triple") != "aarch64-apple-darwin"):
        raise ValueError("Legal companion metadata differs from the selected CPython target")
    return payloads, raw


def retain_legal_snapshot(runtime, payloads, manifest):
    destination = runtime / "legal" / "python-build-standalone"
    destination.mkdir(parents=True)
    for relative, data in payloads.items():
        path = destination / relative
        path.parent.mkdir(exist_ok=True)
        with path.open("xb") as stream:
            stream.write(data)
    with (destination / "legal-manifest.json").open("xb") as stream:
        stream.write(manifest)


def materialize_runtime(source, destination, sign_identity="-"):
    root = source.resolve(strict=True)
    entries, total = 0, 0
    removed_launchers = []

    def copy(path, target, relative, ancestors):
        nonlocal entries, total
        resolved = path.resolve(strict=True)
        if not resolved.is_relative_to(root):
            raise ValueError("Runtime symlink escapes the owned staging root")
        info = resolved.stat()
        entries += 1
        if entries > MAX_FILES:
            raise ValueError("Runtime exceeds file count limit")
        if stat.S_ISDIR(info.st_mode):
            if resolved in ancestors:
                raise ValueError("Runtime contains a directory symlink cycle")
            target.mkdir()
            for child in sorted(resolved.iterdir()):
                if "\\" in child.name or len(str(relative / child.name).encode("utf-8")) > 4096:
                    raise ValueError("Runtime contains an invalid payload path")
                if child.name != "__pycache__":
                    copy(child, target / child.name, relative / child.name, ancestors | {resolved})
        elif stat.S_ISREG(info.st_mode):
            if info.st_size > MAX_FILE:
                raise ValueError("Runtime file exceeds size limit")
            # No installed console wrapper may retain an absolute staging
            # shebang. All supported operations use bin/python3 -m MODULE.
            with resolved.open("rb") as incoming:
                if relative.parts[0] == "bin" and incoming.read(2) == b"#!":
                    removed_launchers.append(relative.as_posix())
                    return
                incoming.seek(0)
                total += info.st_size
                if total > MAX_TOTAL:
                    raise ValueError("Runtime exceeds total byte limit")
                with target.open("xb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing, CHUNK)
            target.chmod(0o755 if info.st_mode & 0o111 else 0o644)
        else:
            raise ValueError("Runtime contains a special file")

    copy(root, destination, PurePosixPath(), set())
    python = destination / "bin" / "python3"
    if python.is_symlink() or not python.is_file() or not os.access(python, os.X_OK):
        raise ValueError("Materialized runtime has no regular executable bin/python3")
    if not (destination / "lib" / "python3.13" / "LICENSE.txt").is_file():
        raise ValueError("Selected CPython license was not retained")
    write_json(destination / "lios-build-changes.json", {
        "schemaVersion": 1, "changes": ["Installed hash-locked core wheels",
            "Materialized internal links as regular files", "Excluded __pycache__ directories",
            "Removed unused bin script wrappers; use bin/python3 -m MODULE"],
        "removedConsoleLaunchers": removed_launchers,
        "codeSigningIdentity": sign_identity,
    })


def hash_files(root):
    files, total = [], 0
    for directory, directories, names in os.walk(root, followlinks=False):
        for name in directories:
            if not stat.S_ISDIR((Path(directory) / name).lstat().st_mode):
                raise ValueError("Final runtime contains a non-directory")
        for name in sorted(names):
            path = Path(directory) / name
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE:
                raise ValueError("Final runtime contains an invalid file")
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(CHUNK), b""):
                    digest.update(chunk)
            total += info.st_size
            files.append({"path": path.relative_to(root).as_posix(), "size": info.st_size,
                          "sha256": digest.hexdigest(), "executable": bool(info.st_mode & 0o111)})
            if len(files) > MAX_FILES or total > MAX_TOTAL:
                raise ValueError("Final runtime exceeds payload limits")
    return sorted(files, key=lambda item: item["path"]), total


MACHO_MAGICS = {
    b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xcf\xfa\xed\xfe",
    b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca", b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca",
}


def sign_and_inventory(root, identity, scratch, environment, runner=None):
    """Sign final regular Mach-O bytes before creating the release inventory."""
    if (not identity or (identity.startswith("-") and identity != "-")
            or any(ord(character) < 32 for character in identity)):
        raise ValueError("Invalid native code-signing identity")
    if runner is None:
        runner = subprocess.run
    native_files = []
    for parent, directories, names in os.walk(root, followlinks=False):
        for name in directories:
            if not stat.S_ISDIR((Path(parent) / name).lstat().st_mode):
                raise ValueError("Cannot sign a payload containing a linked directory")
        for name in names:
            path = Path(parent) / name
            if not stat.S_ISREG(path.lstat().st_mode):
                raise ValueError("Cannot sign a linked or special payload file")
            with path.open("rb") as stream:
                if stream.read(4) in MACHO_MAGICS:
                    native_files.append(path)
    if not native_files:
        raise ValueError("Native runtime contains no Mach-O files to sign")
    for path in sorted(native_files):
        # Ad-hoc signatures have no Team ID: enabling library validation would
        # reject their native extension modules. Developer ID builds retain
        # hardened runtime and require the same signing identity for all bytes.
        command = ["/usr/bin/codesign", "--force", "--sign", identity,
                   "--timestamp=none" if identity == "-" else "--timestamp"]
        if identity != "-":
            command.extend(["--options", "runtime"])
        runner([*command, str(path)],
               check=True, cwd=scratch, env=environment, timeout=300)
        runner(["/usr/bin/codesign", "--verify", "--strict", "--verbose=2", str(path)],
               check=True, cwd=scratch, env=environment, timeout=300)
    return hash_files(root)


def write_json(path, value):
    data = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if len(data) > MAX_METADATA:
        raise ValueError("Generated metadata exceeds limit")
    with path.open("xb") as stream:
        stream.write(data)
    return hashlib.sha256(data).hexdigest()


def publish_new_directory(staging, output):
    # Darwin's RENAME_EXCL provides an atomic no-clobber publish, including
    # against an empty-directory/symlink race after the initial output check.
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renamex_np
    rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(os.fsencode(staging), os.fsencode(output), 0x00000004) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(output))


def main():
    require_target_host()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python-archive", required=True, type=Path)
    parser.add_argument("--archive-sha256", required=True)
    parser.add_argument("--wheel-lock", required=True, type=Path)
    parser.add_argument("--legal-dir", required=True, type=Path,
                        help="Approved full-archive PYTHON.json and licenses snapshot")
    parser.add_argument("--legal-manifest", required=True, type=Path)
    parser.add_argument("--sign-identity", default="-",
                        help="Local ad-hoc '-' by default; release builds supply Developer ID")
    parser.add_argument("--wheelhouse", type=Path,
                        help="Use only these local release wheels, with no index/network")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    version, roots = core_manifest()
    lock = read_regular(args.wheel_lock, MAX_METADATA)
    pins = parse_lock(lock, roots)
    legal_payloads, legal_manifest = legal_snapshot(args.legal_dir, args.legal_manifest)
    wheelhouse = None
    if args.wheelhouse is not None:
        wheelhouse = args.wheelhouse.absolute()
        if wheelhouse.is_symlink() or not wheelhouse.is_dir():
            raise ValueError("Wheelhouse must be a regular local directory")
        for wheel in wheelhouse.iterdir():
            if wheel.is_symlink() or not wheel.is_file() or wheel.suffix != ".whl":
                raise ValueError("Wheelhouse must contain only regular wheel files")
    output = args.output.absolute()
    if os.path.lexists(output):
        raise ValueError("Bundle output must be a fresh new directory")
    if not output.parent.is_dir():
        raise ValueError("Bundle output parent must already exist")
    with tempfile.TemporaryDirectory(prefix=".lios-native-build-", dir=output.parent) as temporary:
        scratch = Path(temporary)
        archive = scratch / "cpython.tar.gz"
        snapshot_archive(args.python_archive, archive, args.archive_sha256)
        extracted = scratch / "extracted"
        extracted.mkdir()
        source = extract_archive(archive, extracted)
        environment = build_environment(scratch)
        python = source / "bin" / "python3"
        baseline = inventory(python, [], scratch, environment)["packages"]
        if not set(baseline).issubset(BOOTSTRAP):
            raise ValueError("Archive contains unexpected preinstalled distributions")
        release_lock = scratch / "core.lock.txt"
        release_lock.write_bytes(lock)
        index = (["--no-index", "--find-links", str(wheelhouse)] if wheelhouse is not None
                 else ["--index-url", "https://pypi.org/simple"])
        run_python(python, ["-m", "pip", "--isolated", "install", "--only-binary=:all:",
                           "--require-hashes", "--no-cache-dir", "--no-compile",
                           "--disable-pip-version-check", *index,
                           "-r", str(release_lock)], scratch, environment)
        run_python(python, ["-m", "pip", "--isolated", "check"], scratch, environment)
        installed = inventory(python, roots, scratch, environment)
        expected = {**baseline, **pins}
        if installed["packages"] != expected or set(installed["closure"]) != set(pins):
            raise ValueError("Installed packages do not equal the exact core dependency closure")
        bundle = scratch / "bundle"
        bundle.mkdir()
        runtime = bundle / "runtime"
        materialize_runtime(source, runtime, args.sign_identity)
        retain_legal_snapshot(runtime, legal_payloads, legal_manifest)
        files, total = sign_and_inventory(runtime, args.sign_identity, scratch, environment)
        # Smoke the final signed, relocated executable and native extensions:
        # successful pre-sign imports do not prove the distributable can run.
        run_python(runtime / "bin" / "python3", ["-m", "pip", "--isolated", "check"], scratch, environment)
        run_python(runtime / "bin" / "python3", ["-c",
            "import math,numpy as np,pandas as pd,scipy.stats as st,statsmodels.api as sm;"
            "assert float(np.mean([1,2,3])) == 2;"
            "assert float(pd.Series([1,2,3]).sum()) == 6;"
            "assert float(st.norm.cdf(0)) == 0.5;"
            "assert math.isclose(float(sm.OLS([2,4,6],[[1],[2],[3]]).fit().params[0]),2,abs_tol=1e-10)"
        ], scratch, environment)
        relocated = inventory(runtime / "bin" / "python3", roots, scratch, environment)
        if relocated != installed:
            raise ValueError("Relocation changed native interpreter/package identity")
        (bundle / "locks").mkdir()
        (bundle / "locks" / "core.lock.txt").write_bytes(lock)
        manifest_sha = write_json(bundle / "manifest.json", {
            "schemaVersion": 1, "target": "darwin-arm64", "manifestVersion": version,
            "pythonVersion": PYTHON_VERSION, "packIds": ["core"],
            "minimumSystemVersion": "14.0",
            "pythonRelativePath": "bin/python3", "installedPackages": installed["packages"],
            "locks": [{"packId": "core", "sha256": hashlib.sha256(lock).hexdigest()}],
            "files": files, "totalBytes": total,
            "source": {"repository": SOURCE_REPOSITORY, "commit": SOURCE_COMMIT,
                       "archiveSha256": args.archive_sha256},
        })
        write_json(bundle / "release.json", {"schemaVersion": 1, "manifestSha256": manifest_sha})
        if sum(path.stat().st_size for path in (bundle / "manifest.json",
               bundle / "release.json", bundle / "locks" / "core.lock.txt")) > MAX_METADATA:
            raise ValueError("Combined bundle metadata exceeds limit")
        publish_new_directory(bundle, output)
    print(json.dumps({"output": str(output), "manifestSha256": manifest_sha,
                      "packIds": ["core"], "files": len(files), "totalBytes": total}))


if __name__ == "__main__":
    main()
