"""Lazy, bounded video preparation inside the isolated WIP."""
from pathlib import Path
import hashlib,json,math,os,re,subprocess,threading,time,shutil,tempfile
W=Path(os.environ['VIDEO_RUNTIME_ROOT'])
ATTACHMENTS=Path(os.environ['VIDEO_ATTACHMENTS_ROOT'])
POLICY='native-v8-6fps-15sec-overlap20-audio-aligned'
CHUNK_SECONDS=15.0
STEP_SECONDS=12.0
MAX_SECONDS=240*60
MAX_BYTES=32*1024**3
INPUT_POLICY=['-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,avi,mpeg,mpegts,hevc,h264,m4v,ogg,gif,flv,asf']
CONTEXT=threading.local()
def check_cancel():
    cancel=getattr(CONTEXT,'cancel',None)
    if cancel is not None and cancel.is_set():raise ValueError('Video preparation canceled')
def run(args,timeout=600):
    check_cancel()
    args=[os.environ.get('DSH_MEDIA_'+args[0].upper(),args[0]),*args[1:]]
    p=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**os.environ,'TMPDIR':str(W/'tmp')})
    deadline=time.monotonic()+timeout
    try:
        while True:
            check_cancel()
            if time.monotonic()>deadline:raise ValueError('Media preparation timed out')
            try:stdout,stderr=p.communicate(timeout=.2);break
            except subprocess.TimeoutExpired:pass
        if p.returncode:raise ValueError('Media decode failed: '+stderr[-1500:])
        return subprocess.CompletedProcess(args,p.returncode,stdout,stderr)
    except BaseException:
        p.kill();p.communicate();raise

def source_path(source):
    p=Path(source.removeprefix('file://')).resolve(strict=True)
    if not any(p.is_relative_to(r.resolve()) for r in (W/'media',ATTACHMENTS)):raise ValueError('Video source must be an upload in this isolated workspace')
    if not p.is_file() or p.stat().st_size>MAX_BYTES:raise ValueError('Video must be a file no larger than 32 GiB')
    return p

def prepare(source):
    check_cancel();p=source_path(source);h=hashlib.sha256()
    with p.open('rb') as f:
        for data in iter(lambda:f.read(4*1024*1024),b''):check_cancel();h.update(data)
    key=h.hexdigest();job=W/'media'/key/POLICY;job.mkdir(parents=True,exist_ok=True)
    manifest=job/'manifest.json'
    if manifest.exists():return {**json.loads(manifest.read_text()),'source':str(p)}
    probe=json.loads(run(['ffprobe','-v','error','-show_streams','-show_format','-of','json']+INPUT_POLICY+[str(p)],120).stdout)
    streams=[s for s in probe.get('streams',[]) if s['codec_type']=='video' and not s.get('disposition',{}).get('attached_pic')]
    if not streams:raise ValueError('File has no video stream')
    v=streams[0]
    if v.get('width',0)*v.get('height',0)>4096*2160:raise ValueError('Video limit: 4096 x 2160 pixels')
    raw=probe.get('format',{}).get('format_name') in ('hevc','h264','m4v')
    def rate(name):
        a,b=map(float,v.get(name,'0/1').split('/'));return a/b if b else 0
    fps=rate('r_frame_rate' if raw else 'avg_frame_rate') or rate('r_frame_rate') or 25
    duration=float(v.get('duration') or probe.get('format',{}).get('duration') or 0)
    if not math.isfinite(duration) or duration<=0:
        counted=json.loads(run(['ffprobe','-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=nb_read_frames','-of','json']+INPUT_POLICY+[str(p)],14400).stdout)
        duration=int(counted['streams'][0]['nb_read_frames'])/fps
    if duration>MAX_SECONDS:raise ValueError('Video limit: 240 minutes per clip')
    if duration<=0:raise ValueError('Could not determine video duration')
    result={'id':key,'policy':POLICY,'source':str(p),'codec':v['codec_name'],'duration':duration,'fps':fps,'videoStream':v['index'],'audioStream':next((s['index'] for s in probe['streams'] if s['codec_type']=='audio'),None),'sampleInterval':1/6,'mode':'native-temporal-video','raw':raw}
    # Unique temporary files permit concurrent preparation of the same upload.
    with tempfile.NamedTemporaryFile(mode='w',dir=job,delete=False) as f:json.dump(result,f,indent=2);tmp=Path(f.name)
    tmp.replace(manifest);return result

def chunks(manifest):
    n=max(1,math.ceil(max(0,manifest['duration']-CHUNK_SECONDS)/STEP_SECONDS)+1)
    return [{**manifest,'chunkIndex':i+1,'chunkCount':n,'start':i*STEP_SECONDS,'end':min(manifest['duration'],i*STEP_SECONDS+CHUNK_SECONDS)} for i in range(n)]

def materialize(part):
    check_cancel()
    if shutil.disk_usage(W).free<5*1024**3:raise ValueError('Less than 5 GiB free for video processing')
    job=Path(tempfile.mkdtemp(prefix='video-chunk-',dir=W/'tmp'));p=source_path(str(W/part['source']));start=part['start'];span=part['end']-start
    try:
        # Input seek yields a timeline relative to the requested interval. Restore original time in the manifest.
        vf="select='isnan(prev_selected_t)+gt(floor(t*6+0.000001),floor(prev_selected_t*6+0.000001))',scale=w='if(gte(dar,1),512,max(2,trunc(512*dar/2)*2))':h='if(gte(dar,1),max(2,trunc(512/dar/2)*2),512)':flags=bicubic,setsar=1,showinfo"
        seek=['-ss',str(start)] if start else []
        # Raw elementary streams lack seek indexes: decode from the beginning, trim before sampling.
        if part.get('raw') and start:
            seek=[];vf=f'trim=start={start}:duration={span},setpts=PTS-STARTPTS,'+vf
        args=['ffmpeg','-nostdin','-hide_banner','-y','-threads','4']+INPUT_POLICY+seek+['-i',str(p),'-t',str(span),'-map',f"0:{part['videoStream']}",'-an','-sn','-vf',vf,'-fps_mode','vfr','-frames:v','92','-threads','4',str(job/'frame-%04d.png')]
        r=run(args,14400 if part.get('raw') else 600);frames=sorted(job.glob('frame-*.png'))
        pts=[float(x)+start for x in re.findall(r'\bn:\s*\d+\s+pts:\s*\S+\s+pts_time:([\d.eE+\-]+)',r.stderr)][:len(frames)]
        if not frames or len(pts)!=len(frames):raise ValueError('Decoder did not return reliable timestamps')
        # ffmpeg may log a lookahead frame outside -t; files are the actual bounded output.
        if len(frames)%2:frames.append(frames[-1]);pts.append(pts[-1])
        pairs=[{'frames':[str(x.relative_to(W)) for x in frames[i:i+2]],'timestamp':round((pts[i]+pts[i+1])/2,6)} for i in range(0,len(frames),2)]
        result={**part,'job':str(job.relative_to(W)),'timestamps':pts,'pairs':pairs,'frames':len(frames),'audio':'no audio track','transcript':[]}
        if part['audioStream'] is not None:
            wav=job/'audio.wav'
            run(['ffmpeg','-nostdin','-v','error','-y']+INPUT_POLICY+['-ss',str(start),'-i',str(p),'-t',str(span),'-map',f"0:{part['audioStream']}",'-vn','-af','aresample=async=1:first_pts=0,apad','-ac','1','-ar','16000',str(wav)])
            from video_audio import transcribe
            result['transcript']=transcribe(wav,start);result['audio']='Whisper speech transcription; Omni sound descriptions supplied separately'
        return result
    except BaseException:shutil.rmtree(job,ignore_errors=True);raise

def release(part):
    if part.get('job'):
        p=W/part['job']
        if p.parent==W/'tmp' and p.name.startswith('video-chunk-'):shutil.rmtree(p,ignore_errors=True)
