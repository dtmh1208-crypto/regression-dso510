// Vercel/Linux build; same entrypoint and hash-based assets as the local build.
import { build } from 'esbuild';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

for (const filename of ['assets/dataset-manifest.json','assets/codebook.json']) {
  if (!existsSync(filename)) throw new Error(`${filename} is missing. Prepare the data locally before deployment.`);
}
const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,'.');
const program=ts.createProgram(parsed.fileNames,parsed.options);
const diagnostics=[...parsed.errors,...ts.getPreEmitDiagnostics(program)];
if(diagnostics.length){console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:ts.sys.getCurrentDirectory,getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));process.exit(1);}
await mkdir('dist/assets',{recursive:true});
await build({entryPoints:['src/main.tsx'],bundle:true,format:'esm',minify:true,target:'es2022',define:{'process.env.NODE_ENV':'"production"'},outfile:'dist/assets/main.js'});
const assets={};
for(const ext of ['js','css']){
  const content=await readFile(`dist/assets/main.${ext}`);
  const filename=`main-${createHash('sha256').update(content).digest('hex').slice(0,12)}.${ext}`;
  await writeFile(`dist/assets/${filename}`,content);assets[ext]=filename;
}
const html=(await readFile('index.html','utf8')).replace('/src/main.tsx',`/assets/${assets.js}`).replace('</head>',`<link rel="stylesheet" href="/assets/${assets.css}"/></head>`);
await writeFile('dist/index.html',html);
console.log('Vercel frontend built. Dataset remains in Supabase; secrets are not embedded in the frontend.');
