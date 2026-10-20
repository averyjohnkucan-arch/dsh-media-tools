"""One scheduler-owned Omni server; no detached GPU process or CPU fallback."""
import base64,json,os,re,socket,subprocess,time,urllib.request,wave
from pathlib import Path
ROOT=Path(__file__).parent
WORKSPACE=Path(os.environ['PROD_WORKSPACE']).resolve(strict=True)
JOB=Path(os.environ['PROD_MEDIA_JOB']).resolve(strict=True)
CONFIG=json.loads(os.environ['DSH_MEDIA_BACKEND_CONFIG'])
class OmniCaptioner:
 def __init__(self,directory):
  self.directory=Path(directory).resolve(strict=True)
  if not self.directory.is_relative_to(JOB):raise ValueError('Omni runtime directory must be inside the chat job')
  self.process=None;self.log=None;self.placement=[]
 def __enter__(self):return self
 def __exit__(self,*_):self.close()
 def failure(self,message):
  detail=''
  try:
   with self.log_path.open('rb') as stream:
    stream.seek(0,2);size=stream.tell();stream.seek(max(0,size-6000));detail=stream.read().decode(errors='replace')
  except (AttributeError,OSError):pass
  return RuntimeError(message+('\nEngine diagnostic tail:\n'+detail if detail else ''))
 def start(self):
  if self.process is not None:raise RuntimeError('Omni already started')
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));self.port=sock.getsockname()[1]
  model=Path(CONFIG['omni_model']);projector=Path(CONFIG['omni_projector'])
  args=[CONFIG['llama_server'],'-m',str(model),'--mmproj',str(projector),
        '--host','127.0.0.1','--port',str(self.port),'--alias','omni-captioner','-lv','4','--jinja','-c','9216','-np','1','-ngl','99','--n-cpu-moe',str(CONFIG.get('cpu_moe_layers',18)),'--fit','off','-b','512','-ub','256','-t','16','-tb','16','--cache-type-k','f16','--cache-type-v','f16']
  env={**os.environ,'CUDA_VISIBLE_DEVICES':'0'}
  self.log_path=self.directory/'omni.log';self.log=self.log_path.open('xb')
  # Inherit the scheduler's process group so cancellation also kills this server.
  self.process=subprocess.Popen(args,cwd=JOB,env=env,stdout=self.log,stderr=self.log)
  deadline=time.monotonic()+240
  while time.monotonic()<deadline:
   if self.process.poll() is not None:raise self.failure('Omni exited during load')
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{self.port}/health',timeout=1) as response:
     if response.status==200:break
   except OSError:pass
   time.sleep(.2)
  else:raise TimeoutError('Omni model loading deadline exceeded')
  logs=self.log_path.read_text(errors='replace')
  layers=re.findall(r'offloaded (\d+)/(\d+) layers to GPU',logs)
  if not layers:raise self.failure('Omni GPU layer placement not confirmed')
  if not re.search(r'CLIP using CUDA[0-9]* backend',logs) or 'CLIP using CPU backend' in logs:
   raise self.failure('Omni audio projector CUDA placement not confirmed')
  self.placement=[line for line in logs.splitlines() if any(term in line.lower() for term in ['offload','backend','buffer size'])]
 def caption(self,audio_path):
  path=Path(audio_path).resolve(strict=True)
  if not path.is_relative_to(self.directory):raise ValueError('Audio window must be inside the job directory')
  with wave.open(str(path),'rb') as audio:
   if (audio.getnchannels(),audio.getsampwidth(),audio.getframerate(),audio.getcomptype())!=(1,2,16000,'NONE'):raise ValueError('Expected 16k mono PCM16 WAV')
   frames=audio.getnframes()
   if not 0<frames<=30*16000:raise ValueError('Audio window must be at most 30 seconds')
   pcm=audio.readframes(frames)
   if len(pcm)!=frames*2:raise ValueError('Truncated audio window')
  if not any(pcm):return {'caption':'Digital silence: all decoded PCM samples are zero.','inference_executed':False,'method':'exact_silence_bypass'}
  if self.process is None:self.start()
  if self.process.poll() is not None:raise RuntimeError('Omni worker is not running')
  payload={'model':'omni-captioner','messages':[{'role':'user','content':[{'type':'input_audio','input_audio':{'data':base64.b64encode(path.read_bytes()).decode(),'format':'wav'}}]}],
           'max_tokens':8192,'temperature':.6,'top_p':.95,'top_k':20,'seed':1234,'stream':False,'logprobs':True,'top_logprobs':1}
  request=urllib.request.Request(f'http://127.0.0.1:{self.port}/v1/chat/completions',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
  start=time.monotonic()
  with urllib.request.urlopen(request,timeout=300) as response:
   raw=response.read(8*1024*1024+1)
   if len(raw)>8*1024*1024:raise ValueError('Omni response exceeds 8 MiB')
   result=json.loads(raw)
  choice=result['choices'][0];text=choice['message'].get('content')
  if not isinstance(text,str) or not text.strip():raise ValueError('Empty Omni caption')
  if choice.get('finish_reason')=='length':raise ValueError('Omni caption truncated; no complete result produced')
  return {'caption':text.strip(),'inference_executed':True,'seconds':time.monotonic()-start,'timings':result.get('timings'),'usage':result.get('usage'),'token_logprobs':choice.get('logprobs'),'finish_reason':choice.get('finish_reason'),'confidence_calibration':'Generated-token likelihoods are not factual correctness probabilities'}
 def close(self):
  if self.process is not None:
   if self.process.poll() is None:
    self.process.terminate()
    try:self.process.wait(timeout=10)
    except subprocess.TimeoutExpired:self.process.kill();self.process.wait(timeout=10)
   self.process=None
  if self.log is not None:self.log.close();self.log=None
