"""On-demand audio captions, cached by source and execution provenance."""
from pathlib import Path
import wave,fcntl
import base64,hashlib,json,math,os,signal,socket,subprocess,tempfile,threading,time,urllib.request
from video_media import W,source_path,run,INPUT_POLICY,check_cancel
ROOT=Path(os.environ['VIDEO_OMNI_ROOT'])
CACHE=ROOT/'caption-cache'
POLICY='omni-5sec-pad1-v2-silence'
MODEL_SHA='f6b443caefee34c82edc51278bbd410ad58146baf6fca53d09035322300034cf'
PROJECTOR_SHA='81d4d92662eb7f387f09b0a6679e945bf61dd0f2ef5ab8d36be6cc9580bb6252'

def segments(duration,core=5,pad=1):
    return [{'index':i+1,'core_start':i*core,'core_end':min(duration,i*core+core),
             'audio_start':max(0,i*core-pad),'audio_end':min(duration,i*core+core+pad)}
            for i in range(math.ceil(duration/core))]

def atomic(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w',dir=path.parent,delete=False) as f:
        json.dump(value,f,indent=2);tmp=Path(f.name)
    tmp.replace(path)

def progress(phase,**extra):
    value={'phase':phase,'at':time.time(),**extra}
    atomic(W/'state/audio-progress.json',value)
    with (W/'evidence/audio-stages.jsonl').open('a') as f:f.write(json.dumps(value)+'\n')
    print('[audio-caption] '+json.dumps(value),flush=True)

def settings():
    return json.loads(os.environ['DSH_MEDIA_BACKEND_CONFIG'])

def provenance():
    return {'policy':POLICY,'model':MODEL_SHA,'projector':PROJECTOR_SHA,**settings()}

def cache_file(manifest,part):
    payload={'source':manifest['id'],'track':manifest['audioStream'],'part':part,'provenance':provenance()}
    if 'audioWindow' in manifest:payload.update(audioWindow=manifest['audioWindow'],confidence_version=1)
    key=hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()
    return CACHE/key[:2]/(key+'.json')

def cached(manifest,part):
    f=cache_file(manifest,part)
    if not f.exists():return None
    try:
        r=json.loads(f.read_text())
        if ('audioWindow' not in manifest or r.get('confidence_version')==1) and r['status']=='complete' and isinstance(r['caption'],str) and r['caption'].strip():return r
    except (ValueError,KeyError):pass
    return None

class Worker:
    def __init__(self):self.proc=None;self.log=None;self.worker_lease=None
    def start(self):
        self.worker_lease=(ROOT/'worker.lock').open('a')
        deadline=time.monotonic()+300
        while True:
            check_cancel()
            try:fcntl.flock(self.worker_lease,fcntl.LOCK_EX|fcntl.LOCK_NB);break
            except BlockingIOError:
                if time.monotonic()>deadline:raise TimeoutError('Another audio captioner is still active')
                time.sleep(.2)
        resident=subprocess.check_output(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],text=True).strip()
        if resident:raise RuntimeError('GPU memory is still owned by another model; refusing concurrent audio load')
        cfg=settings()
        with socket.socket() as available:available.bind(('127.0.0.1',0));self.port=available.getsockname()[1]
        with socket.socket() as s:
            s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(('127.0.0.1',self.port))
        args=[cfg['llama_server'],'-m',cfg['omni_model'],
              '--mmproj',cfg['omni_projector'],
              '--host','127.0.0.1','--port',str(self.port),'--alias','omni-captioner','--jinja',
              '-c',str(cfg.get('context',16384)),'-np','1','-ngl','99','--n-cpu-moe',str(cfg['cpu_moe_layers']),
              '--fit','off','-b','512','-ub','256','-t','12','-tb','12','--cache-type-k','f16','--cache-type-v','f16']
        self.log=(ROOT/'logs/worker.log').open('a')
        self.proc=subprocess.Popen(args,stdout=self.log,stderr=subprocess.STDOUT,start_new_session=False,
            env={**os.environ,'CUDA_VISIBLE_DEVICES':'0'},cwd=ROOT)
        progress('loading_omni',pid=self.proc.pid)
        deadline=time.monotonic()+180
        while time.monotonic()<deadline:
            check_cancel()
            if self.proc.poll() is not None:raise RuntimeError('Omni exited during load; see worker.log')
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{self.port}/health',timeout=1) as r:
                    if r.status==200:return
            except OSError:pass
            time.sleep(.2)
        raise TimeoutError('Omni loading timed out')
    def close(self):
        if self.proc:
            if self.proc.poll() is None:
                self.proc.terminate()
                try:self.proc.wait(timeout=10)
                except subprocess.TimeoutExpired:self.proc.kill();self.proc.wait(timeout=10)
            progress('omni_stopped',pid=self.proc.pid,exit=self.proc.returncode)
            self.proc=None
        if self.log:self.log.close();self.log=None
        if self.worker_lease:self.worker_lease.close();self.worker_lease=None
    def caption(self,wav):
        with wave.open(str(wav),'rb') as audio:
            pcm=audio.readframes(audio.getnframes())
            if audio.getsampwidth()==2 and pcm and not any(pcm):
                return 'Digital silence: all decoded PCM samples are zero.',{'method':'exact_silence_bypass'},{'confidence_kind':'deterministic_pcm_check','logprobs':None,'usage':None}
        cfg=settings()
        data={'model':'omni-captioner','messages':[{'role':'user','content':[{'type':'input_audio','input_audio':{'data':base64.b64encode(wav.read_bytes()).decode(),'format':'wav'}}]}],
            'max_tokens':cfg['max_tokens'],'temperature':cfg.get('temperature',.6),'top_p':.95,'top_k':20,'seed':1234,'stream':False,'logprobs':True,'top_logprobs':1}
        request=urllib.request.Request(f'http://127.0.0.1:{self.port}/v1/chat/completions',data=json.dumps(data).encode(),headers={'Content-Type':'application/json'})
        result={};done=threading.Event()
        def fetch():
            try:
                with urllib.request.urlopen(request,timeout=300) as r:result['value']=json.load(r)
            except urllib.error.HTTPError as e:result['error']=RuntimeError(f'Omni HTTP {e.code}: '+e.read().decode(errors='replace')[:2000])
            except Exception as e:result['error']=e
            finally:done.set()
        thread=threading.Thread(target=fetch,daemon=True);thread.start()
        try:
            deadline=time.monotonic()+300
            while not done.wait(.2):
                check_cancel()
                if time.monotonic()>deadline:raise TimeoutError('Omni caption timed out')
            check_cancel()
        except BaseException:
            self.close();thread.join(timeout=5);raise
        if 'error' in result:raise result['error']
        response=result['value'];choice=response['choices'][0];text=(choice['message'].get('content') or '').strip()
        if not text:raise ValueError('Omni returned an empty caption')
        if choice.get('finish_reason')=='length':raise ValueError('Omni caption truncated; refusing to cache')
        return text,response.get('timings'),{'usage':response.get('usage'),'logprobs':choice.get('logprobs'),'finish_reason':choice.get('finish_reason')}

def extract(manifest,part,wav):
    src=source_path(manifest['source']);start=part['audio_start'];span=part['audio_end']-start
    run(['ffmpeg','-nostdin','-v','error','-y']+manifest.get('inputPolicy',INPUT_POLICY)+['-ss',str(start),'-i',str(src),'-t',str(span),
        '-map',f"0:{manifest['audioStream']}",'-vn','-af','aresample=async=1:first_pts=0,apad','-ac','1','-ar','16000',str(wav)])

def caption_all(manifests):
    tasks=[(m,s) for m in manifests if m['audioStream'] is not None for s in segments(m['duration'],**m.get('audioWindow',{}))]
    missing=[(m,s) for m,s in tasks if cached(m,s) is None]
    progress('audio_cache_check',segments=len(tasks),missing=len(missing))
    if not missing:return
    worker=Worker()
    try:
        worker.start()
        for i,(m,s) in enumerate(missing,1):
            check_cancel();progress('captioning',chunk=i,chunks=len(missing),**s)
            start=time.monotonic()
            with tempfile.TemporaryDirectory(prefix='omni-audio-',dir=W/'tmp') as d:
                wav=Path(d)/'audio.wav';extract(m,s,wav);text,timings,usage=worker.caption(wav)
            atomic(cache_file(m,s),{**s,'source':m['id'],'status':'complete','caption':text,'seconds':time.monotonic()-start,
                   'timings':timings,'usage':usage.get('usage'),'token_logprobs':usage.get('logprobs'),'finish_reason':usage.get('finish_reason'),'confidence_version':1,'provenance':provenance()})
    finally:worker.close()

def captions_for(manifest,start,end):
    return [r for s in segments(manifest['duration'],**manifest.get('audioWindow',{})) if s['audio_start']<end and s['audio_end']>start
            for r in [cached(manifest,s)] if r is not None]
