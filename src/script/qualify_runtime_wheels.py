"""Target-host release qualification using pip's resolver and actual wheel bytes.
No runtime activation or signing. Successful outputs are release candidates only.
"""
import argparse
import email.parser
import hashlib
import json
import os
import platform
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile


def wheel_record(wheel):
    if wheel.suffix != ".whl" or not wheel.is_file() or wheel.is_symlink():
        raise ValueError("Only regular wheel artifacts may enter a release lock")
    with zipfile.ZipFile(wheel) as archive:
        metadata_paths = [name for name in archive.namelist()
                          if name.count("/") == 1 and name.endswith(".dist-info/METADATA")]
        if len(metadata_paths) != 1:
            raise ValueError("Wheel must contain exactly one distribution metadata record")
        metadata = email.parser.BytesParser().parsebytes(archive.read(metadata_paths[0]))
    name, version = metadata.get("Name", ""), metadata.get("Version", "")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
        raise ValueError("Invalid wheel distribution name")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.!+_-]*", version):
        raise ValueError("Invalid wheel distribution version")
    digest = hashlib.sha256()
    with wheel.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"name": re.sub(r"[-_.]+", "-", name).lower(), "version": version,
            "file": wheel.name, "sha256": digest.hexdigest(), "bytes": wheel.stat().st_size}


def lock_records(directory):
    records = [wheel_record(file) for file in sorted(directory.iterdir())]
    if not records or len({record["name"] for record in records}) != len(records):
        raise ValueError("Closure must contain exactly one wheel per distribution")
    return sorted(records, key=lambda record: record["name"])


def run(args):
    subprocess.run(args, check=True, timeout=900)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    request = json.load(sys.stdin)
    if not (3, 11) <= sys.version_info[:2] < (3, 14):
        raise ValueError("Interpreter is outside the canonical managed runtime Python range")
    architecture = {"aarch64": "arm64", "arm64": "arm64", "x86_64": "x64", "amd64": "x64"}.get(platform.machine().lower())
    if request["platform"] != f"{sys.platform}-{architecture}":
        raise ValueError("Python interpreter architecture differs from the declared target host")
    output = Path(args.output).absolute()
    if output.exists():
        raise ValueError("Qualification output must be a new directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".lios-wheel-qualification-", dir=output.parent))
    try:
        evidence = {"schemaVersion": "1", "manifestSha256": request["manifestSha256"],
                    "platform": request["platform"], "python": sys.version.split()[0],
                    "qualified": False, "signed": False, "packs": []}
        core_constraint = None
        for pack in request["packs"]:
            pack_id = pack["id"]
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", pack_id):
                raise ValueError("Invalid pack ID")
            directory = stage / pack_id
            wheels = directory / "wheels"
            wheels.mkdir(parents=True)
            download = [sys.executable, "-m", "pip", "download", "--disable-pip-version-check",
                        "--only-binary=:all:", "--dest", str(wheels)]
            if core_constraint:
                download.extend(["--constraint", str(core_constraint)])
            run(download + pack["specs"])
            records = lock_records(wheels)
            lock = directory / (pack_id + ".lock.txt")
            lock.write_text("".join(f'{r["name"]}=={r["version"]} --hash=sha256:{r["sha256"]}\n' for r in records))
            if pack_id == "core":
                core_constraint = directory / "core.constraints.txt"
                core_constraint.write_text("".join(f'{r["name"]}=={r["version"]}\n' for r in records))
            # Verify actual bytes in a fresh target interpreter, with no index/network fallback.
            environment = directory / "verification-env"
            run([sys.executable, "-m", "venv", str(environment)])
            python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            run([str(python), "-m", "pip", "install", "--disable-pip-version-check", "--no-index",
                 "--find-links", str(wheels), "--require-hashes", "--requirement", str(lock)])
            run([str(python), "-m", "pip", "check"])
            installed = json.loads(subprocess.check_output([str(python), "-m", "pip", "list", "--format=json"]))
            versions = {re.sub(r"[-_.]+", "-", item["name"]).lower(): item["version"] for item in installed}
            if any(versions.get(r["name"]) != r["version"] for r in records):
                raise ValueError("Installed closure differs from locked wheel metadata")
            run([str(python), "-c",
                 "import numpy as n, pandas, scipy.stats as s, statsmodels.api, fastapi, starlette, uvicorn; "
                 "assert float(n.mean([1,2,3])) == 2.0; assert float(s.norm.cdf(0)) == 0.5"])
            shutil.rmtree(environment)
            evidence["packs"].append({"id": pack_id, "specs": pack["specs"], "wheels": records,
                                       "lockSha256": hashlib.sha256(lock.read_bytes()).hexdigest(),
                                       "offlineHashInstall": "passed", "dependencyCheck": "passed",
                                       "coreNativeImportSmoke": "passed"})
        evidence["qualified"] = True
        (stage / "qualification.json").write_text(json.dumps(evidence, indent=2) + "\n")
        stage.rename(output)
        print(json.dumps({"qualified": True, "signed": False, "output": str(output),
                          "packs": [pack["id"] for pack in evidence["packs"]]}))
    finally:
        if stage.exists():
            shutil.rmtree(stage)


if __name__ == "__main__":
    main()
