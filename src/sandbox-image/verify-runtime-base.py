"""Prove installed runtime versions and model bytes before reusing an immutable base."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys

proof = json.load(sys.stdin)
lock = proof['lock']
if sys.version.split()[0] != lock['docling']['runtimePins']['python']:
    raise SystemExit('Inherited Python version differs from pinned runtime')
node = subprocess.check_output(['/usr/bin/node', '--version'], text=True).strip()
xlsx = subprocess.check_output(['/usr/bin/node', '-p', 'require("/opt/lios/node_modules/xlsx/package.json").version'], text=True).strip()
if node != 'v' + lock['node']['version'] or xlsx != lock['xlsx']['version']:
    raise SystemExit('Inherited Node or SheetJS version differs from pinned runtime')
for wheel in proof['wheels']:
    if importlib.metadata.version(wheel['package']) != wheel['version']:
        raise SystemExit('Inherited wheel version differs: ' + wheel['package'])
models = Path('/opt/lios/docling-models')
inventory = proof['models']
if {str(p.relative_to(models)) for p in models.rglob('*') if p.is_file()} != {m['path'] for m in inventory}:
    raise SystemExit('Inherited model file/layout inventory differs')
for item in inventory:
    file = models / item['path']
    if file.is_symlink() or not file.is_file():
        raise SystemExit('Inherited model is missing or symlinked: ' + item['path'])
    with file.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != item['sha256']:
            raise SystemExit('Inherited model bytes differ: ' + item['path'])
import cv2
import docling.document_converter
if cv2.__version__ != '.'.join(lock['docling']['runtimePins']['opencvPythonHeadlessOverride'].split('.')[:3]):
    raise SystemExit('Inherited OpenCV runtime version differs')
if Path('/opt/lios/browser/chromium').exists() or Path('/opt/lios/node_modules/playwright-core').exists():
    raise SystemExit('Inherited baseline unexpectedly contains an unqualified browser runtime')
print('Exact pinned inherited runtime versions, wheel metadata and model bytes verified')
