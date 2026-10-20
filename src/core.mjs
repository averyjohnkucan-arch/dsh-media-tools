import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from './config.mjs';
import {run} from './process.mjs';
import {sourceFile, safeDirectory} from './files.mjs';
import {commandBackend} from './adapters/command.mjs';
import {bundledBackend} from './adapters/bundled.mjs';
import {localV2} from './adapters/local-v2.mjs';
const python = file => fileURLToPath(new URL('../python/' + file, import.meta.url));
export const operations = ['analyze_audio', 'edit_audio', 'transcribe_audio', 'listen_audio', 'probe_video', 'analyze_video', 'convert_audio', 'convert_video'];
const finite = (n, min, max, label) => { if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw Error(`Invalid ${label}: expected ${min}–${max}`); return n; };
export async function execute(operation, args, {workspace, sessionId = 'cli', signal, config: overrides} = {}) {
  if (!operations.includes(operation)) throw Error('Unknown media operation');
  if (!workspace) throw Error('An explicit workspace is required');
  workspace = await fs.realpath(workspace);
  signal?.throwIfAborted();
  const config = await loadConfig(overrides);
  const source = await sourceFile(workspace, args.source_path);
  const root = await safeDirectory(workspace, '.dsh-media');
  const output = await fs.mkdtemp(path.join(root, operation + '-'));
  const relative = file => path.relative(workspace, path.join(output, file));
  const artifacts = []; let result;
  try {
    const environment = {DSH_MEDIA_WORKSPACE: workspace, DSH_MEDIA_FFMPEG: config.ffmpeg, DSH_MEDIA_FFPROBE: config.ffprobe};
    const call = (command, argv, more = {}) => run(command, argv, {cwd: workspace, signal, env: environment, ...more});
    if (operation === 'analyze_audio') {
      const start = finite(args.start_seconds ?? 0, 0, 864000, 'start_seconds');
      const duration = finite(args.duration_seconds ?? 30, 0.001, 120, 'duration_seconds');
      const channel = finite(args.channel ?? 0, 0, 31, 'channel');
      const fft = args.fft_size ?? 2048;
      if (!Number.isInteger(channel) || ![256,512,1024,2048,4096,8192].includes(fft)) throw Error('Invalid channel or FFT size');
      result = JSON.parse(await call(config.python, ['-B', python('analyze.py'), source, path.join(output, 'analysis'), '--start', String(start), '--duration', String(duration), '--channel', String(channel), '--fft-size', String(fft), '--scratch', output]));
      artifacts.push(...['analysis.png', 'waterfall.png', 'report.json', 'spectrum.npz'].map(n => ({path: relative('analysis/' + n), mimeType: n.endsWith('.png') ? 'image/png' : 'application/octet-stream'})));
    } else if (operation === 'edit_audio') {
      const start = finite(args.start_seconds ?? 0, 0, 864000, 'start_seconds');
      const duration = finite(args.duration_seconds ?? 30, 0.01, 7200, 'duration_seconds');
      const gain = finite(args.gain_db ?? 0, -60, 30, 'gain_db');
      const fade = finite(args.fade_seconds ?? 0, 0, duration / 2, 'fade_seconds');
      if (args.normalize !== undefined && typeof args.normalize !== 'boolean') throw Error('normalize must be boolean');
      const filters = [`volume=${gain}dB`];
      if (args.normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
      if (fade) filters.push(`afade=t=in:st=0:d=${fade}`, `afade=t=out:st=${duration-fade}:d=${fade}`);
      await call(config.ffmpeg, ['-nostdin', '-v', 'error', '-n', '-protocol_whitelist', 'file,pipe', '-i', source, '-ss', String(start), '-t', String(duration), '-map', '0:a:0', '-vn', '-af', filters.join(','), '-c:a', 'pcm_s16le', path.join(output, 'edited.wav')]);
      result = {text: 'Saved edited audio as a new WAV.', start_seconds: start, requested_duration_seconds: duration, gain_db: gain, normalized: !!args.normalize, fade_seconds: fade};
      artifacts.push({path: relative('edited.wav'), mimeType: 'audio/wav'});
    } else if (operation === 'convert_audio' || operation === 'convert_video') {
      const audio = operation === 'convert_audio';
      const format = args.format ?? (audio ? 'wav' : 'mp4');
      const codecs = audio ? {wav:['pcm_s16le'],flac:['flac'],mp3:['libmp3lame'],m4a:['aac'],ogg:['libvorbis']} : {mp4:['libx264','aac'],webm:['libvpx-vp9','libopus'],gif:['gif']};
      if (!Object.hasOwn(codecs, format)) throw Error('Unsupported output format');
      const start = finite(args.start_seconds ?? 0,0,864000,'start_seconds');
      const duration = finite(args.duration_seconds ?? 30,0.01,7200,'duration_seconds');
      const options = audio ? ['-map','0:a:0','-vn','-c:a',codecs[format][0]] : ['-map','0:v:0','-c:v',codecs[format][0],'-threads','2'];
      if (!audio && format !== 'gif') options.push('-map','0:a:0?','-c:a',codecs[format][1]);
      if (!audio && format === 'mp4') options.push('-pix_fmt','yuv420p','-movflags','+faststart');
      if (!audio && format === 'gif') options.push('-an','-vf','fps=10,scale=640:-1:flags=lanczos');
      await call(config.ffmpeg, ['-nostdin','-v','error','-n','-protocol_whitelist','file,pipe','-i',source,'-ss',String(start),'-t',String(duration),...options,path.join(output,'converted.'+format)], {timeout:600000});
      result = {text:'Saved converted media as a new file.',format,start_seconds:start,requested_duration_seconds:duration};
      artifacts.push({path:relative('converted.'+format),mimeType: audio ? (format === 'wav' ? 'audio/wav' : 'audio/'+format) : (format === 'gif' ? 'image/gif' : 'video/'+format)});
    } else if (operation === 'transcribe_audio' && config.whisperModel) {
      const extra = args.language ? ['--language', args.language] : [];
      result = JSON.parse(await call(config.python, ['-B', python('transcribe.py'), source, output, '--model', config.whisperModel, '--ffmpeg', config.ffmpeg, ...extra], {timeout: 14400000}));
      artifacts.push({path: relative('transcript.json'), mimeType: 'application/json'});
    } else if (operation === 'probe_video') {
      result = JSON.parse(await call(config.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', source]));
      result.analysis_kind = 'metadata_only';
    } else {
      if (operation === 'analyze_video' && (typeof args.question !== 'string' || !args.question.trim() || args.question.length > 12000)) throw Error('Provide a video question of at most 12000 characters');
      const request = {schema: 1, operation, source, workspace, output, sessionId, question: args.question};
      result = config.backend ? await bundledBackend(request, config, signal) : config.localAIV2Root ? await localV2(request, config, signal) : await commandBackend(request, config, signal);
    }
    signal?.throwIfAborted();
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
    artifacts.push({path: relative('result.json'), mimeType: 'application/json'});
    const display_markdown = artifacts.filter(a => a.mimeType.startsWith('image/') || a.mimeType.startsWith('audio/')).map(a => `![${path.basename(a.path)}](${path.join(workspace, a.path)})`);
    return {operation, result, artifacts, display_markdown};
  } catch (e) { await fs.rm(output, {recursive: true, force: true}); throw e; }
}
export async function doctor(overrides) {
  const config = await loadConfig(overrides), checks = {};
  for (const [name, command, args] of [['python',config.python,['--version']], ['ffmpeg',config.ffmpeg,['-version']], ['ffprobe',config.ffprobe,['-version']]]) {
    try { checks[name] = {ok:true, version:(await run(command, args, {timeout:10000})).split('\n')[0]}; }
    catch(e) { checks[name] = {ok:false, error:e.message}; }
  }
  try { await run(config.python, ['-c','import numpy,scipy,matplotlib,soundfile'], {timeout:30000}); checks.dsp = {ok:true}; }
  catch(e) { checks.dsp = {ok:false,error:e.message}; }
  if (config.whisperModel) {
    try { await fs.access(path.join(config.whisperModel, 'model.bin')); await run(config.python, ['-c','import faster_whisper'], {timeout:30000}); checks.whisper = {ok:true}; }
    catch(e) { checks.whisper = {ok:false,error:e.message}; }
  } else checks.whisper = {ok:false,error:'Set whisperModel to a local faster-whisper model directory, or configure a transcription backend'};
  let local;
  if(config.backend){
    try { for(const key of ['llama_server','omni_model','omni_projector','whisper_model'])await fs.access(config.backend[key]); await fs.access(config.backend.native.engine); await fs.access(config.backend.native.encoder); local={configured:true,ok:true,mode:'bundled-on-demand',requiresV2Service:false,requires_live_qualification:true}; }
    catch(e){local={configured:true,ok:false,mode:'bundled-on-demand',error:e.message};}
  }
  if (!config.backend && config.localAIV2Root) {
    try {
      const router = JSON.parse(await fs.readFile(path.join(config.localAIV2Root,'config/router.json'),'utf8'));
      const response = await fetch(`http://127.0.0.1:${router.port}/health`, {signal:AbortSignal.timeout(3000)});
      local = {configured:true,ok:response.ok,requires_live_qualification:true,...(!response.ok?{error:'V2 router health check failed'}:{})};
    } catch { local = {configured:true,ok:false,requires_live_qualification:true,error:'Configured Local AI v2 companion is not reachable; start it or configure a command backend.'}; }
  }
  checks.listen_backend = local || {configured:!!config.backends?.listen_audio,ok:!!config.backends?.listen_audio,requires_live_qualification:true};
  checks.native_video_backend = local || {configured:!!config.backends?.analyze_video,ok:!!config.backends?.analyze_video,requires_live_qualification:true};
  return {checks, platform:process.platform, dsh_peer:'0.2.1-rc.2', windows_qualified:false};
}
