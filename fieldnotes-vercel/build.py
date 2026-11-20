"""Type-check and build without a background JavaScript build service."""
from pathlib import Path
import os
import subprocess
import hashlib

root=Path(__file__).resolve().parent
os.chdir(root)
subprocess.run(['node',str(root/'node_modules/typescript/bin/tsc'),'--noEmit'],check=True)
binary=root/('node_modules/@esbuild/win32-x64/esbuild.exe' if os.name=='nt' else 'node_modules/@esbuild/linux-x64/bin/esbuild')
(root/'dist/assets').mkdir(parents=True,exist_ok=True)
subprocess.run([str(binary),'src/main.tsx','--bundle','--format=esm','--minify','--target=es2022',
                '--define:process.env.NODE_ENV="production"','--outfile=dist/assets/main.js'],check=True)
source=(root/'index.html').read_text(encoding='utf-8')
assets={}
for extension in ['js','css']:
    content=(root/f'dist/assets/main.{extension}').read_bytes()
    filename=f'main-{hashlib.sha256(content).hexdigest()[:12]}.{extension}'
    (root/'dist/assets'/filename).write_bytes(content)
    assets[extension]=filename
source=source.replace('/src/main.tsx',f'/assets/{assets["js"]}').replace('</head>',f'<link rel="stylesheet" href="/assets/{assets["css"]}"/></head>')
(root/'dist/index.html').write_text(source,encoding='utf-8')
print('Production interface built in dist/.')
