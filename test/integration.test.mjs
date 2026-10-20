import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Context} from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import {createScope} from '@deepseek-ai/dsh-scope';
import * as audio from '../src/audio-plugin.mjs';
import * as video from '../src/video-plugin.mjs';
import {run} from '../src/process.mjs';
import {loadConfig} from '../src/config.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const root=fileURLToPath(new URL('..',import.meta.url));
const cfg=await loadConfig({python:process.env.DSH_MEDIA_PYTHON||'python3'});
const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-media-integration-'));
test.after(async()=>fs.rm(workspace,{recursive:true,force:true}));
await run(cfg.ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1',path.join(workspace,'tone.wav')]);
function context(){
 const ctx=new Context(); new SystemPrompt(ctx,{}); new ToolRuntime(ctx);
 ctx.provide('attachments',{
  async saveImage(a){return {attachmentId:'sha256:'+a.name,name:a.name,mediaType:a.mediaType};},
  async saveFile(a){return {attachmentId:'sha256:'+a.name,name:a.name};},
  async *readFileStream(){yield await fs.readFile(path.join(workspace,'tone.wav'));}
 });
 return ctx;
}
test('real Cordis plugins register, emit inline images, disable separately and re-enable',async()=>{
 const ctx=context();
 try{
  const a=await ctx.plugin(audio,cfg); const v=await ctx.plugin(video,cfg);
  assert.equal(ctx.tools.schemas().length,8);
  const agent={id:'fixture',session:{id:'fixture',header:{cwd:workspace},snapshotEvents:()=>[{type:'user/message',data:{type:'file',attachment:{attachmentId:'sha256:tone',name:'tone.wav'}}}]}};
  agent.ctx=createScope(ctx,agent).ctx;
  const result=await ctx.tools.execute({name:'analyze_audio',arguments:{duration_seconds:0.5},agent,callId:'plot',signal:new AbortController().signal});
  assert(!result.isError,JSON.stringify(result));assert.equal(result.value.images.length,2);
  assert.equal(result.content.filter(x=>x.type==='image').length,2);
  await a.dispose();
  assert.deepEqual(ctx.tools.schemas().map(t=>t.name).sort(),['analyze_video','convert_video','probe_video']);
  await ctx.plugin(audio,cfg); assert.equal(ctx.tools.schemas().length,8);
  await v.dispose(); assert.equal(ctx.tools.schemas().length,5);
 }finally{await ctx.fiber.dispose();}
});
test('plugin disposal cancels its active tool call',async()=>{
 const backend=path.join(workspace,'wait.mjs'); await fs.writeFile(backend,'process.stdin.resume(); setInterval(()=>{},1000);');
 const ctx=context();
 try{
  const fiber=await ctx.plugin(audio,{...cfg,localAIV2Root:undefined,backends:{listen_audio:{command:process.execPath,args:[backend]}}});
  const agent={id:'cancel',session:{id:'cancel',header:{cwd:workspace},snapshotEvents:()=>[]}};agent.ctx=createScope(ctx,agent).ctx;
  const pending=ctx.tools.execute({name:'listen_audio',arguments:{source_path:'tone.wav'},agent,callId:'cancel',signal:new AbortController().signal});
  await new Promise(resolve=>setTimeout(resolve,200)); await fiber.dispose();
  const r=await pending; assert(r.isError);assert.match(JSON.stringify(r),/disabled|abort|cancel/i);
 }finally{await ctx.fiber.dispose();}
});
test('official MCP SDK discovers eight tools and returns real plot image blocks',async()=>{
 const client=new Client({name:'integration-test',version:'1.0.0'});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'src/mcp.mjs'),'--workspace',workspace],env:{...process.env,DSH_MEDIA_PYTHON:cfg.python}});
 try{
  await client.connect(transport); assert.equal((await client.listTools()).tools.length,8);
  const r=await client.callTool({name:'analyze_audio',arguments:{source_path:'tone.wav',duration_seconds:0.5}});
  assert(!r.isError,JSON.stringify(r));assert.equal(r.content.filter(x=>x.type==='image').length,2);
  const bad=await client.callTool({name:'analyze_audio',arguments:{source_path:'../elsewhere.wav'}});assert(bad.isError);
 }finally{await client.close();}
});
test('installer copies movable runtime; repeats; preserves unrelated and edited skills; uninstalls',async()=>{
 const folder=path.join(workspace,'install'),prefix=path.join(folder,'skills'),runtime=path.join(folder,'runtime'),config=path.join(folder,'config.json');
 await fs.mkdir(path.join(prefix,'unrelated'),{recursive:true}); await fs.writeFile(path.join(prefix,'unrelated','keep'),'keep');
 const argv=[path.join(root,'src/install.mjs'),'--prefix',prefix,'--runtime-prefix',runtime,'--skip-npm'];
 const opts={env:{DSH_MEDIA_CONFIG:config},timeout:120000};
 await run(process.execPath,argv,opts); await run(process.execPath,argv,opts);
 const helper=path.join(prefix,'dsh-audio','scripts/media.mjs');assert.match(await run(process.execPath,[helper,'--help']),/analyze_audio/);
 const skill=path.join(prefix,'dsh-audio','SKILL.md'),original=await fs.readFile(skill,'utf8');
 await fs.appendFile(skill,'\nlocal edit\n'); await assert.rejects(run(process.execPath,argv,opts),/local changes/);
 await fs.writeFile(skill,original); await run(process.execPath,[...argv,'--uninstall'],opts);
 assert.equal(await fs.readFile(path.join(prefix,'unrelated','keep'),'utf8'),'keep');await assert.rejects(fs.access(path.join(prefix,'dsh-audio')));
 assert((await fs.readdir(runtime)).length===2);
});
