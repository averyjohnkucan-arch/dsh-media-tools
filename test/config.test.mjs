import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

test('skipped package install scripts fall back to system FFmpeg instead of a missing binary',async t=>{
 const root=await mkdtemp(join(tmpdir(),'media-no-build-scripts-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const module=join(root,'config.mjs');
 await copyFile(new URL('../src/config.mjs',import.meta.url),module);
 for(const [name,value] of [['ffmpeg-static',join(root,'missing-ffmpeg')],['@ffprobe-installer/ffprobe',{path:join(root,'missing-ffprobe')}]]){
  const folder=join(root,'node_modules',name);await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'index.js'),'module.exports = '+JSON.stringify(value)+';');
 }
 const output=execFileSync(process.execPath,['--input-type=module','-e',`const {loadConfig}=await import(${JSON.stringify(pathToFileURL(module).href)});console.log(JSON.stringify(await loadConfig()));`],{encoding:'utf8',env:{...process.env,DSH_MEDIA_CONFIG:join(root,'absent-config.json')}});
 const config=JSON.parse(output);assert.equal(config.ffmpeg,'ffmpeg');assert.equal(config.ffprobe,'ffprobe');
});
