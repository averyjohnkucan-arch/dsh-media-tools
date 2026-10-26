import {createHash, randomUUID} from 'node:crypto';
import {createReadStream, constants} from 'node:fs';
import {mkdir, readFile, rename, open, lstat, realpath} from 'node:fs/promises';
import {dirname, resolve, relative, isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Each plugin owns its catalog, downloads and lifecycle. No models load here.
export class RecommendedModels {
 constructor(catalogUrl, root, fetcher=fetch){this.catalogUrl=catalogUrl;this.root=resolve(root);this.fetcher=fetcher;this.jobs=new Map();this.closed=false;}
 async catalog(){return JSON.parse(await readFile(this.catalogUrl,'utf8'));}
 async list(){return {...await this.catalog(),directory:this.root,jobs:[...this.jobs.values()].map(({promise,controller,...job})=>job)};}
 async action(action,payload={}){
  if(this.closed)throw Error('Plugin is unloaded.');
  if(action==='recommended')return this.list();
  if(action==='recommendedCancel'){this.jobs.get(payload.id)?.controller.abort();return this.list();}
  if(action!=='recommendedDownload')throw Error('Unknown recommended-model operation.');
  if([...this.jobs.values()].some(j=>j.status==='running'))throw Error('Wait for the current download or cancel it.');
  const model=(await this.catalog()).models.find(m=>m.id===payload.id);
  if(!model)throw Error('Recommended model not found.');
  if(!model.files.length||model.files.some(f=>!f.downloadable))throw Error('This setup contains locally converted files. Use the existing model importer; exact hashes are shown in Recommended.');
  const directory=resolve(this.root,model.id),id=randomUUID(),controller=new AbortController();
  const job={id,modelId:model.id,status:'running',progress:'Preparing download',received:0,total:model.files.reduce((s,f)=>s+(f.size||0),0),directory,paths:[],controller};
  this.jobs.set(id,job);
  job.promise=(async()=>{
   await mkdir(directory,{recursive:true});
   for(const file of model.files){
    controller.signal.throwIfAborted();
    const path=await this.download(file,directory,controller.signal,job);
    job.paths.push({role:file.role,path,target:file.target});
   }
   const receipt={modelId:model.id,files:model.files.map((f,i)=>({...f,path:job.paths[i].path})),verifiedAt:new Date().toISOString()};
   const temp=join(directory,'.receipt-'+randomUUID()+'.json');
   const handle=await open(temp,'wx',0o600);try{await handle.writeFile(JSON.stringify(receipt,null,2)+'\n');}finally{await handle.close();}
   await rename(temp,join(directory,'download-receipt.json'));
   job.status='complete';job.progress='Verified. Add these files using the model importer below.';
  })().catch(e=>{job.status=controller.signal.aborted?'cancelled':'failed';job.progress=e.message;}).finally(()=>{delete job.promise;});
  return {id};
 }
 async safePath(directory,target){
  if(typeof target!=='string'||!target||target.includes('\\')||target.split('/').some(x=>!x||x==='.'||x==='..')||isAbsolute(target))throw Error('Invalid catalog destination.');
  // Every existing path component must be real, never a symlink to another file.
  const root=await realpath(directory),path=resolve(root,target);
  if(relative(root,path).startsWith('..')||isAbsolute(relative(root,path)))throw Error('Destination escapes model directory.');
  for(const part of [path,dirname(path)]){try{if((await lstat(part)).isSymbolicLink())throw Error('Model destination cannot be a symlink.');}catch(e){if(e.code!=='ENOENT')throw e;}}
  const parts=relative(root,dirname(path)).split('/').filter(Boolean);let cursor=root;
  for(const part of parts){cursor=join(cursor,part);await mkdir(cursor,{recursive:true});if((await lstat(cursor)).isSymbolicLink())throw Error('Model destination cannot be a symlink.');}
  return path;
 }
 async digest(path,file,signal){
  const sha=createHash('sha256'),git=file.gitBlob?createHash('sha1'):null;
  if(git)git.update('blob '+(await lstat(path)).size+'\0');
  for await(const block of createReadStream(path,{signal})){sha.update(block);git?.update(block);}
  const digest=sha.digest('hex');
  if(file.sha256&&digest!==file.sha256)throw Error('SHA-256 mismatch: '+file.name);
  if(file.gitBlob&&git.digest('hex')!==file.gitBlob)throw Error('Git blob mismatch: '+file.name);
  const size=(await lstat(path)).size;if(file.size!=null&&size!==file.size)throw Error('Size mismatch: '+file.name);
  return digest;
 }
 async download(file,directory,signal,job){
  if(!/^[\w.-]+\/[\w.-]+$/.test(file.repo)||!/^[a-f0-9]{40}$/.test(file.revision)||!(file.sha256||file.gitBlob))throw Error('Catalog download requires a repository, immutable revision and content hash.');
  const path=await this.safePath(directory,file.target),part=await this.safePath(directory,file.target+'.part');
  try{await lstat(path);job.progress='Verifying '+file.name;await this.digest(path,file,signal);job.received+=(await lstat(path)).size;return path;}catch(e){if(e.code!=='ENOENT')throw e;}
  let offset=0;try{offset=(await lstat(part)).size;}catch(e){if(e.code!=='ENOENT')throw e;}
  const url='https://huggingface.co/'+file.repo+'/resolve/'+file.revision+'/'+file.file.split('/').map(encodeURIComponent).join('/');
  const response=await this.fetcher(url,{headers:offset?{Range:'bytes='+offset+'-'}:{},signal});
  if(response.status===416&&file.size===offset){await this.digest(part,file,signal);await rename(part,path);job.received+=offset;return path;}
  if(!response.ok||!response.body)throw Error('Download failed ('+response.status+'): '+file.name);
  if(offset&&response.status===206&&!response.headers.get('content-range')?.startsWith('bytes '+offset+'-'))throw Error('Invalid resumed download range.');
  if(response.status!==206)offset=0;
  const handle=await open(part,(offset?constants.O_APPEND:constants.O_TRUNC)|constants.O_CREAT|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  job.received+=offset;job.progress='Downloading '+file.name;
  try{for await(const block of response.body){signal.throwIfAborted();await handle.writeFile(block);job.received+=block.byteLength;}}finally{await handle.close();}
  job.progress='Verifying '+file.name;await this.digest(part,file,signal);signal.throwIfAborted();
  await rename(part,path);return path;
 }
 async dispose(){this.closed=true;for(const job of this.jobs.values())job.controller.abort();await Promise.allSettled([...this.jobs.values()].map(j=>j.promise).filter(Boolean));}
}

const instances=new WeakMap();
export function recommendedFor(owner,moduleUrl,root){let instance=instances.get(owner);if(!instance){instance=new RecommendedModels(new URL('./recommended-models.json',moduleUrl),join(root,'recommended-models'));instances.set(owner,instance);}return instance;}
export async function disposeRecommended(owner){await instances.get(owner)?.dispose();}
