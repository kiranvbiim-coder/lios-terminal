import hashlib
import json
import os
import pathlib
import subprocess
import tempfile

models_root = pathlib.Path('/opt/lios/docling-models')
manifest_path = pathlib.Path('/opt/lios/docling-models.manifest.json')
models = json.loads(manifest_path.read_text(encoding='utf-8'))
expected = {item['path']: item['sha256'] for item in models}
actual = {str(p.relative_to(models_root)) for p in models_root.rglob('*') if p.is_file()}
if actual != set(expected):
    raise SystemExit('Docling model files/layout differ from trusted inventory')
for relative, digest in expected.items():
    path = models_root / relative
    if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise SystemExit(f'Docling model integrity check failed: {relative}')
if os.environ.get('DOCLING_ARTIFACTS_PATH') != str(models_root):
    raise SystemExit('DOCLING_ARTIFACTS_PATH is not configured to the bundled models')

# Minimal valid one-page PDF containing searchable text; offsets are computed exactly.
def make_pdf(path):
    stream = b"BT /F1 18 Tf 72 720 Td (LiOS isolated Docling PDF smoke) Tj ET\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, body in enumerate(objects, 1):
        offsets.append(len(out))
        out.extend(f"{index} 0 obj\n".encode("ascii"))
        out.extend(body + b"\nendobj\n")
    xref = len(out)
    out.extend(f"xref\n0 {len(offsets)}\n".encode("ascii"))
    out.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        out.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    out.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii"))
    pathlib.Path(path).write_bytes(out)

with tempfile.TemporaryDirectory(prefix='lios-smoke-') as temporary:
    pdf = pathlib.Path(temporary) / 'minimal.pdf'
    make_pdf(pdf)
    from docling.document_converter import DocumentConverter
    result = DocumentConverter().convert(str(pdf))
    text = result.document.export_to_text()
    if 'LiOS isolated Docling PDF smoke' not in text:
        raise SystemExit('Docling default pipeline did not convert the minimal PDF text')
    subprocess.run(['/opt/node/bin/node', '/opt/lios/smoke-xlsx.cjs'], check=True, env=os.environ.copy())

import cv2
if not cv2.__version__:
    raise SystemExit('OpenCV headless runtime import failed')
if os.getuid() != 10001 or os.environ.get('HF_HUB_OFFLINE') != '1' or os.environ.get('TRANSFORMERS_OFFLINE') != '1':
    raise SystemExit('Sandbox smoke did not run rootless with offline model environment')
subprocess.run(['/opt/node/bin/node', '-e', 'if (process.getuid() !== 10001) process.exit(1); console.log("node offline ok")'], check=True, env=os.environ.copy())

browser_lock = json.loads(pathlib.Path('/opt/lios/browser-source-lock.json').read_text())['browser']
module = pathlib.Path(browser_lock['modulePath'])
if json.loads((module / 'package.json').read_text())['version'] != browser_lock['playwrightVersion']:
    raise SystemExit('Bundled Playwright version differs from source lock')
browser_descriptor = next(b for b in json.loads((module / 'browsers.json').read_text())['browsers'] if b['name'] == 'chromium')
if browser_descriptor['revision'] != browser_lock['chromiumRevision']:
    raise SystemExit('Bundled Chromium revision differs from Playwright')
version = subprocess.check_output([browser_lock['executablePath'], '--version'], text=True)
if browser_lock['browserVersion'] not in version:
    raise SystemExit('Bundled Chromium executable version differs from source lock')
for notice in [module / 'LICENSE', module / 'NOTICE', pathlib.Path('/opt/lios/browser/LICENSE.txt')]:
    if not notice.is_file():
        raise SystemExit('Bundled browser rights notice is missing')
subprocess.run(['/opt/node/bin/node', '-e',
                'const p = require(process.argv[1]); if (typeof p.chromium.launch !== \"function\") process.exit(1)',
                str(module)], check=True, env=os.environ.copy())
