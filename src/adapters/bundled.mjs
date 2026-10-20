import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {run} from '../process.mjs';
export async function bundledBackend(request, config, signal) {
  const backend=config.backend;
  if (!backend) throw Error('Run dsh-media setup-backends to provision the bundled inference runtime and model paths.');
  const libraries=JSON.parse(await run(config.python,['-c',"import glob,json,site; print(json.dumps([p for s in site.getsitepackages() for p in glob.glob(s+'/nvidia/*/lib')]))"],{signal,timeout:10000}));
  const scratch=await fs.mkdtemp('/tmp/dsh-media-native-');
  const env={DSH_MEDIA_JOB_DIRECTORY:scratch,DSH_MEDIA_BACKEND_CONFIG:JSON.stringify(backend),DSH_MEDIA_FFMPEG:config.ffmpeg,DSH_MEDIA_FFPROBE:config.ffprobe,
    LD_LIBRARY_PATH:[...(backend.libraryDirs||[]),...libraries,process.env.LD_LIBRARY_PATH||''].join(path.delimiter),
    HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',CUDA_VISIBLE_DEVICES:String(backend.gpu??0)};
  try {
  const text=await run(config.python,['-B',fileURLToPath(new URL('../../python/backend/worker.py',import.meta.url))],{cwd:request.workspace,signal,env,input:JSON.stringify(request)+'\n',timeout:14400000});
  const result=JSON.parse(text);
  if (request.operation==='analyze_video' && (result.mode!=='native-temporal-video'||result.native_engine?.mrope!==true||!(result.native_engine?.video_pad_tokens>0))) throw Error('Bundled engine did not produce native temporal evidence');
  if (typeof result.text!=='string'||!Number.isFinite(result.duration_seconds)) throw Error('Invalid bundled media result');
  if (result.source) result.source=path.relative(request.workspace,request.source);
  return result;
  } finally { await fs.rm(scratch,{recursive:true,force:true}); }
}
