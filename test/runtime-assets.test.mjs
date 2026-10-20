import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {installNativeRuntime} from '../src/runtime-assets.mjs';
import {run} from '../src/process.mjs';
for(const corrupt of [false,true])test(`native asset integrity and installation (corrupt=${corrupt})`,{skip:process.platform!=='linux'||process.arch!=='x64'},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-native-asset-'));let server;
 try{
  const fixture=path.join(root,'fixture');await fs.mkdir(path.join(fixture,'bin'),{recursive:true});await fs.mkdir(path.join(fixture,'omni'));
  await fs.writeFile(path.join(fixture,'bin','strata'),'native fixture');await fs.writeFile(path.join(fixture,'LICENSE.strata'),'fixture license');
  const archive=path.join(root,'runtime.tar.gz');await run('tar',['-czf',archive,'-C',fixture,'bin','omni','LICENSE.strata']);
  const data=await fs.readFile(archive);
  server=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/gzip'});res.end(data);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const manifest={url:`http://127.0.0.1:${server.address().port}/runtime`,sha256:corrupt?'0'.repeat(64):createHash('sha256').update(data).digest('hex')};
  const destination=path.join(root,'installed');
  if(corrupt){await assert.rejects(installNativeRuntime(destination,{manifest}),/SHA256 mismatch/);await assert.rejects(fs.access(destination));}
  else{await installNativeRuntime(destination,{manifest});assert.equal(await fs.readFile(path.join(destination,'bin','strata'),'utf8'),'native fixture');}
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
});
