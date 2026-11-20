"""Create a small source handoff; dataset and secrets are deliberately separate."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = ['package.json','tsconfig.json','index.html','vite.config.js','vercel.json',
         '.python-version','.gitignore','.vercelignore','.env.example','requirements.txt',
         'server.py','data_access.py','api_service.py','build.py','Start Playground.cmd',
         'README.md','DEPLOYMENT.md','test_service.py','test_hosting.py']

def package():
    release = ROOT / 'release'
    release.mkdir(exist_ok=True)
    target = release / 'fieldnotes-vercel-source.zip'
    paths = [ROOT / filename for filename in FILES]
    for folder in ['api','assets','src','scripts']:
        paths.extend(p for p in (ROOT / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
    with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(set(paths)):
            archive.write(path,path.relative_to(ROOT).as_posix())
    print(f'Prepared {target.name}: {target.stat().st_size/1e6:.2f} MB; data and credentials are not included.')

if __name__ == '__main__':package()
