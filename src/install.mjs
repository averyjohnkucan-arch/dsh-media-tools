#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {run} from './process.mjs';
import {importPortablePython} from './python-runtime.mjs';
import {configPath} from './config.mjs';
const {values} = parseArgs({options:{help:{type:'boolean'},uninstall:{type:'boolean'},prefix:{type:'string'},'runtime-prefix':{type:'string'},'setup-python':{type:'boolean'},'include-backends':{type:'boolean'},'backend-config':{type:'string'},python:{type:'string'},'whisper-model':{type:'string'},'local-ai':{type:'string'},'skip-npm':{type:'boolean'}}});
if (values.help) {
 console.log('node src/install.mjs [--setup-python] [--python python3] [--whisper-model PATH] [--local-ai ROOT]\n  --prefix PATH          Skill destination (default ~/.agents/skills)\n  --runtime-prefix PATH  Runtime releases (default ~/.local/share/dsh-media-tools)\n  --uninstall            Remove only unchanged skills owned by this installer; preserve config and runtime\n  --skip-npm             Offline install for CLI-only use; MCP dependencies must be supplied separately');
} else {
 const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
 const prefix = path.resolve(values.prefix || path.join(os.homedir(),'.agents','skills'));
 const runtimePrefix = path.resolve(values['runtime-prefix'] || path.join(os.homedir(),'.local','share','dsh-media-tools'));
 const marker = '.dsh-media-install.json';
 const digest = async folder => {
  const entries = [];
  async function walk(dir) { for (const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
   if (entry.name === marker) continue;
   const file = path.join(dir,entry.name);
   if (entry.isDirectory()) await walk(file);
   else if (entry.isFile()) entries.push([path.relative(folder,file),createHash('sha256').update(await fs.readFile(file)).digest('hex')]);
   else throw Error('Unexpected symlink in installed skill');
  }}
  await walk(folder); return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
 };
 const owned = async dir => {
  let state;
  try { state = JSON.parse(await fs.readFile(path.join(dir,marker),'utf8')); }
  catch(e) { if (e.code === 'ENOENT') { try { await fs.lstat(dir); } catch(x) { if(x.code === 'ENOENT') return false; throw x; } throw Error(`Refusing to replace unowned skill: ${dir}`); } throw e; }
  if (state.package !== 'dsh-media-tools' || state.digest !== await digest(dir)) throw Error(`Installed skill has local changes; preserve it before replacing: ${dir}`);
  return true;
 };
 const names = ['dsh-audio','dsh-video'];
 await fs.mkdir(prefix,{recursive:true});
 for (const name of names) await owned(path.join(prefix,name));
 if (values.uninstall) {
  for (const name of names) if (await owned(path.join(prefix,name))) await fs.rm(path.join(prefix,name),{recursive:true});
  console.log('Removed owned skills. Runtime releases, config, models and workspace outputs preserved.');
 } else {
  await fs.mkdir(runtimePrefix,{recursive:true});
  const release = await fs.mkdtemp(path.join(runtimePrefix,'0.2.1-'));
  for (const name of ['src','python','skills','docs','package.json','package-lock.json','npm-shrinkwrap.json','requirements.txt','requirements-cuda.txt','native-runtime.json','cordis.patch.yml','audio.patch.yml','video.patch.yml','README.md','LICENSE','THIRD_PARTY_NOTICES.md','provenance.json']) {
   try { await fs.cp(path.join(source,name),path.join(release,name),{recursive:true}); }
   catch(e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (!values['skip-npm']) await run(process.platform === 'win32' ? 'npm.cmd' : 'npm',['ci','--omit=dev'],{cwd:release,timeout:180000});
  let settings = {};
  try { settings = JSON.parse(await fs.readFile(configPath(),'utf8')); } catch(e) { if(e.code !== 'ENOENT') throw e; }
  if (values['setup-python']) {
   let bootstrapPython=values.python||'python3';
   if(values['local-ai']&&!values.python&&process.platform==='linux'){
    const imported=path.join(path.resolve(values['local-ai']),'runtime','python');
    const portable=path.join(runtimePrefix,'python-standalone');
    try{
     await fs.access(path.join(imported,'bin','python3'));
     bootstrapPython=await importPortablePython(imported,portable);
    }catch(e){if(e.code!=='ENOENT')throw e;}
   }
   await run(bootstrapPython,['-m','venv',path.join(release,'.venv')],{timeout:120000});
   settings.python = path.join(release,'.venv',process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
   await run(settings.python,['-m','pip','install','-r',path.join(release,'requirements.txt')],{timeout:600000});
  } else if (values.python) settings.python = values.python;
  if (values['whisper-model']) settings.whisperModel = path.resolve(values['whisper-model']);
  if (values['local-ai']) settings.localAIV2Root = path.resolve(values['local-ai']);
  await fs.mkdir(path.dirname(configPath()),{recursive:true});
  await fs.writeFile(configPath(),JSON.stringify(settings,null,2)+'\n',{mode:0o600});
  if(values['include-backends']||values['local-ai']||values['backend-config']) {
   const args=[path.join(release,'src/setup-backends.mjs')];
   if(values['local-ai'])args.push('--import-v2',values['local-ai']);
   else if(values['backend-config'])args.push('--backend-config',values['backend-config']);
   else throw Error('Backend setup needs --local-ai for one-time import or --backend-config with selected model paths.');
   await run(process.execPath,args,{timeout:900000});
  }
  for (const name of names) {
   const destination = path.join(prefix,name), temporary = await fs.mkdtemp(path.join(prefix,'.dsh-media-'));
   await fs.cp(path.join(release,'skills',name),temporary,{recursive:true});
   await fs.mkdir(path.join(temporary,'scripts'),{recursive:true});
   // JSON-encoded import URL handles spaces and quotes; no shell command generation.
   const realURL = new URL('src/cli.mjs', (await import('node:url')).pathToFileURL(release + path.sep)).href;
   await fs.writeFile(path.join(temporary,'scripts','media.mjs'),`#!/usr/bin/env node\nimport ${JSON.stringify(realURL)};\n`);
   await fs.writeFile(path.join(temporary,marker),JSON.stringify({package:'dsh-media-tools',version:'0.2.1',runtime:release,digest:await digest(temporary)},null,2));
   const backup = destination + '.previous-' + Date.now();
   const exists = await owned(destination);
   if (exists) await fs.rename(destination,backup);
   try { await fs.rename(temporary,destination); } catch(e) { if(exists) await fs.rename(backup,destination); throw e; }
   if(exists) await fs.rm(backup,{recursive:true});
  }
  console.log(JSON.stringify({skills:names.map(n=>path.join(prefix,n)),runtime:release,config:configPath(),mcp:{command:process.execPath,args:[path.join(release,'src','mcp.mjs'),'--workspace','REPLACE_WITH_WORKSPACE']}},null,2));
 }
}
