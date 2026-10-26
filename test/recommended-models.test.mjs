import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {RecommendedModels} from '../src/recommended-models.mjs';

const bytes=Buffer.from('small model fixture\n');
async function fixture(t,fetcher,override={}){
 const root=await mkdtemp(join(tmpdir(),'recommended-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file={name:'weights.gguf',target:'weights.gguf',role:'modelPath',repo:'owner/model',revision:'a'.repeat(40),file:'weights.gguf',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),downloadable:true,...override};
 const catalog=join(root,'catalog.json');await writeFile(catalog,JSON.stringify({models:[{id:'sample',files:[file]}]}));
 const models=new RecommendedModels(pathToFileURL(catalog),join(root,'downloads'),fetcher);t.after(()=>models.dispose());return{models,root,file};
}
async function settled(models){await Promise.all([...models.jobs.values()].map(j=>j.promise));return(await models.list()).jobs.at(-1);}
test('downloads pinned bytes, verifies and records provenance; repeated use verifies existing files',async t=>{
 let requests=0;const{models,root}=await fixture(t,async url=>{requests++;assert.match(url,/\/resolve\/a{40}\/weights.gguf$/);return new Response(bytes);});
 await models.action('recommendedDownload',{id:'sample'});let job=await settled(models);assert.equal(job.status,'complete');assert.deepEqual(await readFile(job.paths[0].path),bytes);
 const receipt=JSON.parse(await readFile(join(job.directory,'download-receipt.json'),'utf8'));assert.equal(receipt.files[0].sha256,createHash('sha256').update(bytes).digest('hex'));
 await models.action('recommendedDownload',{id:'sample'});assert.equal((await settled(models)).status,'complete');assert.equal(requests,1);
});
test('resumes partial downloads and rejects wrong content without publishing a final file',async t=>{
 const{models,root}=await fixture(t,async(url,options)=>{assert.equal(options.headers.Range,'bytes=6-');return new Response(bytes.subarray(6),{status:206,headers:{'content-range':'bytes 6-'+(bytes.length-1)+'/'+bytes.length}});});
 await mkdir(join(root,'downloads/sample'),{recursive:true});await writeFile(join(root,'downloads/sample/weights.gguf.part'),bytes.subarray(0,6));
 await models.action('recommendedDownload',{id:'sample'});assert.equal((await settled(models)).status,'complete');
 const bad=await fixture(t,async()=>new Response(Buffer.alloc(bytes.length)));
 await bad.models.action('recommendedDownload',{id:'sample'});assert.equal((await settled(bad.models)).status,'failed');await assert.rejects(readFile(join(bad.root,'downloads/sample/weights.gguf')), {code:'ENOENT'});
});
test('refuses mutable revisions, path traversal, symlink destinations, and local-only artifacts',async t=>{
 for(const override of [{revision:'main'},{target:'../escape'},{downloadable:false}]){
  const{models}=await fixture(t,async()=>{throw Error('network must not run');},override);
  if(!override.downloadable&&'downloadable'in override)await assert.rejects(models.action('recommendedDownload',{id:'sample'}),/local/);
  else{await models.action('recommendedDownload',{id:'sample'});assert.equal((await settled(models)).status,'failed');}
 }
 const{models,root}=await fixture(t,async()=>{throw Error('network must not run');});await mkdir(join(root,'downloads/sample'),{recursive:true});await writeFile(join(root,'outside'),'private');await symlink(join(root,'outside'),join(root,'downloads/sample/weights.gguf'));
 await models.action('recommendedDownload',{id:'sample'});assert.equal((await settled(models)).status,'failed');assert.equal(await readFile(join(root,'outside'),'utf8'),'private');
});
test('disposal cancels pending network work and waits for teardown',async t=>{
 const{models}=await fixture(t,(url,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});if(signal.aborted)reject(signal.reason);}));
 await models.action('recommendedDownload',{id:'sample'});await new Promise(resolve=>setImmediate(resolve));await models.dispose();assert.equal((await models.list()).jobs[0].status,'cancelled');await assert.rejects(models.action('recommended'),/unloaded/);
});
