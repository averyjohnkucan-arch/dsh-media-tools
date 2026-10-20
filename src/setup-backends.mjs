#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {loadConfig,configPath} from './config.mjs';
import {run} from './process.mjs';
const {values}=parseArgs({options:{'import-v2':{type:'string'},'backend-config':{type:'string'},'runtime-directory':{type:'string'},'skip-python':{type:'boolean'},help:{type:'boolean'}}});
if(values.help){console.log('node src/setup-backends.mjs --import-v2 /path/to/V2\n  Copies native executables into a package-owned cache and imports model references. V2 is not launched or required afterward.\nnode src/setup-backends.mjs --backend-config /path/to/backend-models.json\n  Uses a portable backend manifest with explicitly selected models; installs the published Linux x64 runtime automatically.');process.exit(0);}
const config=await loadConfig(),cache=path.resolve(values['runtime-directory']||path.join(os.homedir(),'.cache','dsh-media','native-v0.2.0'));
await fs.mkdir(cache,{recursive:true});
let backend;
if(values['import-v2']){
 const root=await fs.realpath(values['import-v2']);
 const media=JSON.parse(await fs.readFile(path.join(root,'config/media.json'),'utf8'));
 const native=JSON.parse(await fs.readFile(path.join(root,'config/native-video.json'),'utf8'));
 const profile=JSON.parse(await fs.readFile(native.profile,'utf8'));
 const bin=path.join(cache,'bin');await fs.mkdir(bin,{recursive:true});
 for(const [source,name] of [[native.engine,'strata'],[native.encoder,'strata-vision-video']]){await fs.copyFile(source,path.join(bin,name));await fs.chmod(path.join(bin,name),0o755);}
 const omni=path.join(cache,'omni');await fs.mkdir(omni,{recursive:true});
 for(const entry of await fs.readdir(path.dirname(media.llama_server),{withFileTypes:true})){
  if(entry.name==='llama-server'||/\.so(?:\.|$)/.test(entry.name)) await fs.copyFile(path.join(path.dirname(media.llama_server),entry.name),path.join(omni,entry.name));
 }
 await fs.chmod(path.join(omni,'llama-server'),0o755);
 for(const option of ['--pack','--native','--mtp']){const i=profile.args.indexOf(option);if(i>=0)profile.args[i+1]=await fs.realpath(profile.args[i+1]);}
 const expert=profile.args.indexOf('--expert-profile');
 if(expert>=0){await fs.copyFile(profile.args[expert+1],path.join(cache,'expert-profile.bin'));profile.args[expert+1]=path.join(cache,'expert-profile.bin');}
 profile.tokenizer=await fs.realpath(profile.tokenizer);
 for(const field of ['model','mmproj'])profile.vision[field]=await fs.realpath(profile.vision[field]);
 profile.exe=path.join(bin,'strata');profile.vision.exe=path.join(bin,'strata-vision-video');
 profile.cwd=cache;profile.log=path.join(cache,'unused-profile.log');delete profile.lib_dirs;
 backend={schema:1,cacheDirectory:cache,gpu:0,whisper_model:await fs.realpath(media.whisper_model),omni_model:await fs.realpath(media.omni_model),omni_projector:await fs.realpath(media.omni_projector),llama_server:path.join(omni,'llama-server'),cpu_threads:8,cpu_moe_layers:18,max_tokens:8192,context:9216,temperature:0.6,libraryDirs:[omni],native:{engine:path.join(bin,'strata'),encoder:path.join(bin,'strata-vision-video'),model_name:native.model_name,profile}};
}else if(values['backend-config']){
 backend=JSON.parse(await fs.readFile(values['backend-config'],'utf8'));
 // Runtime installation is handled by the published asset installer. Models stay explicit.
 const {installNativeRuntime}=await import('./runtime-assets.mjs');
 await installNativeRuntime(cache);
 backend={...backend,cacheDirectory:cache,llama_server:path.join(cache,'omni','llama-server'),libraryDirs:[path.join(cache,'omni')],native:{...backend.native,engine:path.join(cache,'bin','strata'),encoder:path.join(cache,'bin','strata-vision-video')}};
}else throw Error('Provide --import-v2 to reuse installed models, or --backend-config with explicit model/pack paths. See docs/standalone-backends.md.');
if(!values['skip-python']) await run(config.python,['-m','pip','install','-r',fileURLToPath(new URL('../requirements-cuda.txt',import.meta.url))],{timeout:600000});
for(const field of ['whisper_model','omni_model','omni_projector','llama_server'])await fs.access(backend[field]);
let saved={};try{saved=JSON.parse(await fs.readFile(configPath(),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
saved.backend=backend;saved.whisperModel=backend.whisper_model;delete saved.localAIV2Root;
await fs.mkdir(path.dirname(configPath()),{recursive:true});await fs.writeFile(configPath(),JSON.stringify(saved,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({configured:true,mode:'bundled-on-demand',cache,config:configPath(),requiresV2Service:false},null,2));
