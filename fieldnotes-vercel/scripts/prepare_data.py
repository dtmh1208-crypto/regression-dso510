"""Create a frozen all-column cohort and upload instructions; never upload data."""
from pathlib import Path
import gzip
import hashlib
import io
import json
import sys
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import dictionary

def prepare():
    source = ROOT.parent / 'output_file.csv'
    output = ROOT / 'supabase-upload'
    assets = ROOT / 'assets'
    output.mkdir(exist_ok=True)
    assets.mkdir(exist_ok=True)
    temporary = output / 'preparing.csv.gz'
    raw_n = cohort_n = 0
    columns = pd.read_csv(source, nrows=0).columns.tolist()
    # Use one gzip member with a fixed timestamp for a reproducible checksum.
    with temporary.open('wb') as binary, gzip.GzipFile(filename='', mode='wb', fileobj=binary, mtime=0, compresslevel=6) as compressed:
        with io.TextIOWrapper(compressed, encoding='utf-8', newline='') as text:
            for chunk in pd.read_csv(source, chunksize=20000, low_memory=False):
                raw_n += len(chunk)
                chunk['MENTHLTH'] = chunk.MENTHLTH.replace(88, 0)
                mask = chunk.MENTHLTH.between(0,30) & chunk.SLEPTIM1.between(1,24) & chunk.EMPLOY1.between(1,8)
                retained = chunk.loc[mask]
                retained.to_csv(text, index=False, header=cohort_n == 0, lineterminator='\n')
                cohort_n += len(retained)
                print(f'Prepared {cohort_n:,} of {raw_n:,} rows scanned', flush=True)
    if (raw_n, cohort_n) != (356158, 320546):
        raise RuntimeError('Source row counts differ from this assignment. Review the source before generating a new deployment.')
    digest = hashlib.sha256(temporary.read_bytes()).hexdigest()
    filename = f'brfss-part1-{digest[:12]}.csv.gz'
    target = output / filename
    temporary.replace(target)
    info = {'version':1, 'object_name':filename, 'sha256':digest, 'compressed_bytes':target.stat().st_size,
            'raw_n':raw_n, 'cohort_n':cohort_n, 'columns':columns,
            'cleaning':{'MENTHLTH':'88 -> 0; retain 0..30', 'SLEPTIM1':'retain 1..24', 'EMPLOY1':'retain 1..8'}}
    if info['compressed_bytes'] >= 50_000_000:
        raise RuntimeError('Prepared file exceeds the conservative 50 MB upload ceiling. Do not upload it to a Free bucket.')
    (assets / 'dataset-manifest.json').write_text(json.dumps(info, indent=2)+'\n', encoding='utf-8')
    (assets / 'codebook.json').write_text(json.dumps(dictionary(False), ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    (output / 'UPLOAD-THIS-FILE.txt').write_text(f'Upload {filename}\nSize: {info["compressed_bytes"]/1e6:.2f} MB\nRows: {cohort_n:,}; columns: {len(columns)}\nPrivate bucket: fieldnotes-data\nKeep the filename and contents unchanged.\nSee ../DEPLOYMENT.md for the remaining setup.\n',encoding='utf-8')
    print(f'Ready: {target.name} ({info["compressed_bytes"]/1e6:.2f} MB), {cohort_n:,} rows, all {len(columns)} columns.', flush=True)

if __name__ == '__main__':
    prepare()
