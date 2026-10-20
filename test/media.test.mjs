import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execute} from '../src/core.mjs';
import {run} from '../src/process.mjs';
import {loadConfig} from '../src/config.mjs';
const cfg = await loadConfig({python:process.env.DSH_MEDIA_PYTHON || 'python3'});
const workspace = await fs.mkdtemp(path.join(os.tmpdir(),'dsh-media-test-'));
const options = {workspace,config:cfg};
test.after(async() => fs.rm(workspace,{recursive:true,force:true}));
await run(cfg.ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-c:a','pcm_s16le',path.join(workspace,'tone.wav')]);
await run(cfg.ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=6:d=2','-i',path.join(workspace,'tone.wav'),'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',path.join(workspace,'clip.mp4')]);
test('real tone FFT and plot artifacts match independent oracle',async() => {
 const r = await execute('analyze_audio',{source_path:'tone.wav',duration_seconds:1,fft_size:8192},options);
 assert(Math.abs(r.result.dominant_frequency_hz-440) < 48000/8192);
 assert.equal(r.result.clipped_sample_count,0);
 assert.equal(r.artifacts.filter(a=>a.mimeType==='image/png').length,2);
 for(const a of r.artifacts) assert((await fs.stat(path.join(workspace,a.path))).size>100);
 assert.equal(r.display_markdown.length,2);
});
test('MP4 audio decoding retains timestamps and measured tone',async() => {
 const r=await execute('analyze_audio',{source_path:'clip.mp4',start_seconds:0.5,duration_seconds:1,fft_size:8192},options);
 assert.equal(r.result.decoder,'ffmpeg'); assert.equal(r.result.start_seconds,0.5);
 assert(Math.abs(r.result.dominant_frequency_hz-440)<6);
});
test('trim/gain creates new WAV with independently checked duration and level',async() => {
 const r=await execute('edit_audio',{source_path:'tone.wav',start_seconds:0.5,duration_seconds:1,gain_db:-6},options);
 const report=JSON.parse(await run(cfg.python,['-c','import soundfile as s,sys,numpy as n; a,r=s.read(sys.argv[1]); print(__import__("json").dumps({"seconds":len(a)/r,"peak":float(n.max(n.abs(a)))}))',path.join(workspace,r.artifacts[0].path)]));
 assert.equal(report.seconds,1); assert(report.peak>0.06&&report.peak<0.065);
 assert((await fs.stat(path.join(workspace,'tone.wav'))).size>100);
});
test('conversion extracts audio and produces MP4/WebM/GIF',async() => {
 const audio=await execute('convert_audio',{source_path:'clip.mp4',format:'flac',duration_seconds:1},options);
 assert((await fs.stat(path.join(workspace,audio.artifacts[0].path))).size>100);
 for(const format of ['mp4','webm','gif']) {
  const r=await execute('convert_video',{source_path:'clip.mp4',format,duration_seconds:1},options);
  assert((await fs.stat(path.join(workspace,r.artifacts[0].path))).size>100);
 }
});
test('video probe explicitly reports metadata only',async() => {
 const r=await execute('probe_video',{source_path:'clip.mp4'},options);
 assert.equal(r.result.analysis_kind,'metadata_only'); assert(r.result.streams.some(s=>s.codec_type==='video'));
});
test('traversal, symlink escape, bad parameters and malformed input fail cleanly',async() => {
 await fs.symlink(os.tmpdir(),path.join(workspace,'outside'));
 for(const name of ['../outside.wav','/etc/passwd','outside/other.wav']) await assert.rejects(execute('analyze_audio',{source_path:name},options));
 await assert.rejects(execute('analyze_audio',{source_path:'tone.wav',duration_seconds:121},options),/duration/);
 await fs.writeFile(path.join(workspace,'bad.mp4'),'not a media file');
 await assert.rejects(execute('analyze_audio',{source_path:'bad.mp4'},options));
 assert(!(await fs.readdir(path.join(workspace,'.dsh-media'))).some(n=>n.startsWith('upload-')));
});
test('native video rejects missing backend and fake still-image evidence',async() => {
 await assert.rejects(execute('analyze_video',{source_path:'clip.mp4',question:'What happens?'},{workspace,config:{...cfg,localAIV2Root:undefined,backends:{}}}),/Configure/);
 const backend=path.join(workspace,'fake.mjs');
 await fs.writeFile(backend,`process.stdin.resume(); process.stdin.on('end',()=>console.log(JSON.stringify({text:'blue',duration_seconds:2,mode:'static-frames'})));`);
 await assert.rejects(execute('analyze_video',{source_path:'clip.mp4',question:'What happens?'},{workspace,config:{...cfg,localAIV2Root:undefined,backends:{analyze_video:{command:process.execPath,args:[backend]}}}}),/native temporal/);
});
test('command backend preserves transcript result and native evidence contract',async() => {
 const backend=path.join(workspace,'native-contract.mjs');
 await fs.writeFile(backend,`let b='';process.stdin.on('data',x=>b+=x);process.stdin.on('end',()=>{const q=JSON.parse(b);console.log(JSON.stringify({text:q.question||'speech',duration_seconds:2,mode:'native-temporal-video',native_engine:{mrope:true,video_pad_tokens:2}}));});`);
 const r=await execute('analyze_video',{source_path:'clip.mp4',question:'contract test'},{workspace,config:{...cfg,localAIV2Root:undefined,backends:{analyze_video:{command:process.execPath,args:[backend]}}}});
 assert.equal(r.result.text,'contract test');
 // This validates protocol only, not model quality or actual temporal inference.
});
test('cancellation reaps worker and cleans failed output',async() => {
 const backend=path.join(workspace,'sleep.mjs'); await fs.writeFile(backend,'process.stdin.resume(); setInterval(()=>{},1000);');
 const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(Error('test cancellation')),200);
 const before=await fs.readdir(path.join(workspace,'.dsh-media'));
 try { await assert.rejects(execute('listen_audio',{source_path:'tone.wav'},{workspace,signal:controller.signal,config:{...cfg,localAIV2Root:undefined,backends:{listen_audio:{command:process.execPath,args:[backend]}}}}),/test cancellation/); }
 finally {clearTimeout(timer);}
 assert.deepEqual(await fs.readdir(path.join(workspace,'.dsh-media')),before);
});
test('local Whisper transcribes a generated speech fixture', {skip:!process.env.DSH_MEDIA_WHISPER_MODEL},async() => {
 await run('espeak-ng',['-w',path.join(workspace,'speech.wav'),'The blue car turns left.']);
 const r=await execute('transcribe_audio',{source_path:'speech.wav'},{workspace,config:{...cfg,whisperModel:process.env.DSH_MEDIA_WHISPER_MODEL}});
 assert.match(r.result.text,/blue car/i); assert.match(r.result.text,/left/i); assert(r.result.segments.length>0);
});
