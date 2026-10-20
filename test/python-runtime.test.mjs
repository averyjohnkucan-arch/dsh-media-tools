import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {importPortablePython} from '../src/python-runtime.mjs';
for(const cached of [false,true])test(`portable Python links survive removal of source (cached=${cached})`,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-python-link-'));
 try{
  const source=path.join(root,'original with spaces'),destination=path.join(root,'installed');
  await fs.mkdir(path.join(source,'bin'),{recursive:true});
  await fs.writeFile(path.join(source,'bin','python3.12'),'interpreter fixture');
  await fs.symlink('python3.12',path.join(source,'bin','python3'));
  await fs.symlink(path.join(source,'bin','python3.12'),path.join(source,'bin','python'));
  if(cached)await fs.cp(source,destination,{recursive:true});
  const executable=await importPortablePython(source,destination);
  await fs.rename(source,source+'-unavailable');
  assert.equal(await fs.readFile(executable,'utf8'),'interpreter fixture');
  assert.equal(await fs.readFile(path.join(destination,'bin','python'),'utf8'),'interpreter fixture');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
