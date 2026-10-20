import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {run} from './process.mjs';
export async function installNativeRuntime(destination, options = {}) {
 if(process.platform!=='linux'||process.arch!=='x64')throw Error('Published native runtime currently supports Linux x64 only; do not infer Windows/macOS compatibility.');
 const manifest=options.manifest||JSON.parse(await fs.readFile(new URL('../native-runtime.json',import.meta.url),'utf8'));
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-media-download-'));
 try{
  const archive=path.join(temporary,'runtime.tar.gz');
  const combined=await fs.open(archive,'wx');
  try{
   const parts=manifest.parts||[{url:manifest.url}];
   for(let i=0;i<parts.length;i++){
    const part=parts[i],piece=path.join(temporary,'part-'+i);
    const response=await fetch(part.url,{signal:AbortSignal.timeout(180000)});
    if(!response.ok)throw Error(`Runtime asset download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body),createWriteStream(piece,{flags:'wx'}));
    const digest=createHash('sha256');let bytes=0;
    for await(const chunk of createReadStream(piece)){digest.update(chunk);bytes+=chunk.length;}
    const actual=digest.digest('hex');
    if((part.sha256&&actual!==part.sha256)||(part.bytes!==undefined&&bytes!==part.bytes))throw Error('Native runtime part SHA256 mismatch');
    for await(const chunk of createReadStream(piece))await combined.writeFile(chunk);
    await fs.rm(piece);
   }
  }finally{await combined.close();}
  const hash=createHash('sha256');for await(const chunk of createReadStream(archive))hash.update(chunk);
  if(hash.digest('hex')!==manifest.sha256)throw Error('Native runtime SHA256 mismatch');
  const names=(await run('tar',['-tzf',archive])).trim().split('\n');
  if(names.some(n=>path.isAbsolute(n)||n.split('/').includes('..')||! /^(bin\/|omni\/|LICENSE\.)/.test(n)))throw Error('Unexpected runtime archive paths');
  await fs.mkdir(destination,{recursive:true});await run('tar',['-xzf',archive,'-C',destination]);
  await fs.writeFile(path.join(destination,'runtime-receipt.json'),JSON.stringify(manifest,null,2)+'\n');
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
}
