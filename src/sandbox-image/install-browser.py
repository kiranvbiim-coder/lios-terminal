"""Install only the separately hash-locked browser payload; never fetch at build time."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import tarfile
import zipfile

inputs = Path('/tmp/browser-inputs')
lock = json.loads(Path('/opt/lios/browser-source-lock.json').read_text())
browser = lock['browser']


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inventory(pin):
    file = inputs / pin['file']
    if digest(file) != pin['sha256']:
        raise RuntimeError('Browser inventory checksum mismatch: ' + pin['file'])
    entries = json.loads(file.read_text())
    if not entries:
        raise RuntimeError('Browser inventory is empty')
    return entries


def safe_path(name, prefix):
    parts = PurePosixPath(name).parts
    if not parts or parts[0] != prefix or name.startswith('/') or '\\' in name or '..' in parts:
        raise RuntimeError('Unsafe browser archive entry: ' + name)
    return parts


artifacts = inventory(browser['artifactInventory'])
dependencies = inventory(browser['dependencyInventory'])
for entry in artifacts + dependencies:
    relative = entry['filename'] if entry in artifacts else 'browser-debs/' + entry['filename']
    if '/' in entry['filename'] or '\\' in entry['filename'] or entry['filename'] in ('.', '..'):
        raise RuntimeError('Invalid browser input filename')
    file = inputs / relative
    if not file.is_file() or file.is_symlink() or digest(file) != entry['sha256']:
        raise RuntimeError('Browser input checksum mismatch: ' + relative)
    if file.stat().st_size != entry['size']:
        raise RuntimeError('Browser input size mismatch: ' + relative)

# APT orders Pre-Depends before unpack/configure; dpkg --install over the whole batch does not.
# Every artifact is already locked above, and network acquisition is forbidden at this stage.
subprocess.run([
    'apt-get', '--yes', '--no-download', '--no-install-recommends',
    '-o', 'Dpkg::Use-Pty=0', 'install',
    '-o', 'Dir::Cache::archives=' + str(inputs / 'browser-debs') + '/',
    *[str(inputs / 'browser-debs' / d['filename']) for d in dependencies],
], check=True, env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'})
for dep in dependencies:
    actual = subprocess.check_output(['dpkg-query', '-W', '-f=${Version} ${Architecture}', dep['package']], text=True)
    if actual != dep['version'] + ' ' + dep['architecture']:
        raise RuntimeError('Installed browser dependency differs from lock: ' + dep['package'])
    if not Path(dep['copyrightPath']).is_file():
        raise RuntimeError('Browser dependency copyright notice is missing: ' + dep['package'])

module = Path(browser['modulePath'])
module.mkdir(parents=True)
with tarfile.open(inputs / browser['playwrightArchive'], 'r:gz') as archive:
    for entry in archive:
        parts = safe_path(entry.name, 'package')
        target = module.joinpath(*parts[1:])
        if entry.isdir():
            target.mkdir(parents=True, exist_ok=True)
        elif entry.isfile():
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(entry) as source, target.open('xb') as destination:
                shutil.copyfileobj(source, destination)
            target.chmod(0o755 if entry.mode & 0o111 else 0o644)
        else:
            raise RuntimeError('Non-regular Playwright archive member: ' + entry.name)
if json.loads((module / 'package.json').read_text())['version'] != browser['playwrightVersion']:
    raise RuntimeError('Playwright module version mismatch')
if digest(module / 'browsers.json') != browser['browsersJsonSha256']:
    raise RuntimeError('Playwright browsers.json checksum mismatch')
chromium = next(b for b in json.loads((module / 'browsers.json').read_text())['browsers'] if b['name'] == 'chromium')
if chromium['revision'] != browser['chromiumRevision'] or chromium['browserVersion'] != browser['browserVersion']:
    raise RuntimeError('Chromium revision/version differs from Playwright browsers.json')
for name in ['LICENSE', 'NOTICE']:
    if not (module / name).is_file():
        raise RuntimeError('Playwright license/notice is missing')

browser_dir = Path(browser['executablePath']).parent
browser_dir.mkdir(parents=True)
with zipfile.ZipFile(inputs / browser['chromiumArchive']) as archive:
    for entry in archive.infolist():
        parts = safe_path(entry.filename, browser['chromiumArchiveRoot'])
        if any('widevine' in p.lower() for p in parts) or stat.S_ISLNK(entry.external_attr >> 16):
            raise RuntimeError('Unexpected proprietary or symlink browser member: ' + entry.filename)
        target = browser_dir.joinpath(*parts)
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as source, target.open('xb') as destination:
                shutil.copyfileobj(source, destination)
            target.chmod(0o755 if entry.external_attr >> 16 & 0o111 else 0o644)
executable = browser_dir / browser['chromiumArchiveRoot'] / 'chrome'
if not os.access(executable, os.X_OK):
    raise RuntimeError('Chromium executable is missing')
Path(browser['executablePath']).symlink_to(executable)
shutil.copyfile(inputs / 'chromium-LICENSE.txt', browser_dir / 'LICENSE.txt')
ldd = subprocess.check_output(['ldd', str(executable)], text=True, stderr=subprocess.STDOUT)
if 'not found' in ldd:
    raise RuntimeError('Chromium shared-library closure is incomplete: ' + ldd)
