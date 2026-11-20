"""Read the original CSV locally, or fetch an immutable prepared cohort from Supabase."""
from functools import lru_cache
from pathlib import Path
import hashlib
import json
import os
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent

def mode():
    value = os.environ.get('DATASET_MODE', 'supabase' if os.environ.get('VERCEL') else 'raw')
    if value not in {'raw', 'prepared', 'supabase'}:
        raise RuntimeError('DATASET_MODE must be raw, prepared, or supabase.')
    return value

@lru_cache(maxsize=1)
def manifest():
    path = ROOT / 'assets/dataset-manifest.json'
    if not path.exists():
        raise RuntimeError('Prepared dataset manifest is missing. Run python scripts/prepare_data.py before packaging.')
    return json.loads(path.read_text(encoding='utf-8'))

def checksum(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def storage_request():
    url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    bucket = os.environ.get('SUPABASE_STORAGE_BUCKET', 'fieldnotes-data')
    if not url or not key:
        raise RuntimeError('Hosted data is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.')
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
        raise RuntimeError('SUPABASE_URL must be your HTTPS project URL without a path.')
    # Object name comes from the packaged manifest, never a browser parameter.
    target = f'{url}/storage/v1/object/authenticated/{quote(bucket, safe="")}/{quote(manifest()["object_name"], safe="/")}'
    return Request(target, headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Accept-Encoding':'identity'})

def download_dataset(destination):
    info = manifest()
    request = storage_request()
    partial = None
    try:
        digest = hashlib.sha256()
        total = 0
        destination.parent.mkdir(parents=True, exist_ok=True)
        with urlopen(request, timeout=90) as response, tempfile.NamedTemporaryFile(dir=destination.parent, suffix='.part', delete=False) as output:
            partial = Path(output.name)
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                total += len(block)
                if total > info['compressed_bytes']:
                    raise RuntimeError('Downloaded dataset size differs from the prepared manifest. Upload the exact generated file.')
                digest.update(block)
                output.write(block)
        if total != info['compressed_bytes'] or digest.hexdigest() != info['sha256']:
            raise RuntimeError('Downloaded dataset failed its integrity check. Upload the exact generated file without changing its name or contents.')
        os.replace(partial, destination)
        partial = None
    except HTTPError as error:
        raise RuntimeError(f'Supabase dataset download failed (HTTP {error.code}). Check the bucket, uploaded object, and server-side service-role key.') from None
    except (URLError, TimeoutError, OSError):
        raise RuntimeError('Cannot retrieve the dataset from Supabase. Check project availability and retry.') from None
    finally:
        if partial is not None:
            partial.unlink(missing_ok=True)

@lru_cache(maxsize=1)
def dataset_path():
    selected_mode = mode()
    if selected_mode == 'raw':
        path = ROOT.parent / 'output_file.csv'
        if not path.exists():
            raise RuntimeError('Original CSV was not found. Configure DATASET_MODE=supabase for hosting.')
        return path
    info = manifest()
    if selected_mode == 'prepared':
        path = Path(os.environ.get('PREPARED_DATASET_PATH', str(ROOT / 'supabase-upload' / info['object_name'])))
        if not path.is_file() or checksum(path) != info['sha256']:
            raise RuntimeError('Prepared dataset is missing or does not match the manifest.')
        return path
    path = Path(tempfile.gettempdir()) / 'fieldnotes-data' / info['object_name']
    # Warm invocations reuse the loaded path and cached columns. A fresh process
    # verifies an existing /tmp copy before reusing it.
    if not path.is_file() or path.stat().st_size != info['compressed_bytes'] or checksum(path) != info['sha256']:
        download_dataset(path)
    return path

def prepared():
    return mode() != 'raw'
