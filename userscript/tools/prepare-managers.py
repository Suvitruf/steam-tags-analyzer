"""Download official, pinned managers for isolated integration tests only."""
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile
from hashlib import sha256
import io
import json
import shutil
import struct

root = Path(__file__).resolve().parents[1] / '.test-managers'
packages = [
    ('violentmonkey', '2.50.0',
     'https://github.com/violentmonkey/violentmonkey/releases/download/v2.50.0/Violentmonkey-mv3-v2.50.0.zip',
     '72f1de5a2edc4bc3cd3b3ca06c2b3631cdde4f06f8ed9e8b2b565bf77258b36c'),
    ('tampermonkey', '5.4.1',
     'https://www.tampermonkey.net/crx/tampermonkey_stable.crx',
     'a124e3189ecc0981ce79ef182dd3897a75fe22fc7bf0828e9d293ad7122d3d4d'),
]
root.mkdir(exist_ok=True)
for name, version, url, expected in packages:
    with urlopen(url, timeout=30) as response:
        data = response.read(20_000_001)
    if len(data) > 20_000_000 or sha256(data).hexdigest() != expected:
        raise SystemExit(f'{name}: download changed; review the official release and update the test pin')
    if data[:4] == b'Cr24':
        crx_version = struct.unpack_from('<I', data, 4)[0]
        if crx_version != 3:
            raise SystemExit(f'{name}: unexpected CRX format')
        data = data[12 + struct.unpack_from('<I', data, 8)[0]:]
    target = root / name
    with ZipFile(io.BytesIO(data)) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        if manifest['version'] != version:
            raise SystemExit(f'{name}: unexpected version')
        for item in archive.infolist():
            if not (target / item.filename).resolve().is_relative_to(target.resolve()):
                raise SystemExit('Unsafe archive path')
        shutil.rmtree(target, ignore_errors=True)
        archive.extractall(target)
    print(f'{name} {version}: {target}')
