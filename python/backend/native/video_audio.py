import atexit,json,os,select,subprocess,threading,time,sys
from pathlib import Path
from video_media import W,check_cancel
A=Path(os.environ['VIDEO_SUPPORT_ROOT'])
LOCK=threading.Lock();PROC=None

def close():
    global PROC
    if PROC is not None:
        PROC.kill();PROC.wait(timeout=10)
        for stream in (PROC.stdin,PROC.stdout):stream.close()
        PROC=None
atexit.register(close)
def read_line(timeout):
    deadline=time.monotonic()+timeout
    while not select.select([PROC.stdout],[],[],.2)[0]:
        check_cancel()
        if time.monotonic()>deadline:raise ValueError('Speech transcription timed out')
    check_cancel();line=PROC.stdout.readline()
    if not line:raise ValueError('Speech transcription worker exited')
    return line.strip()
def transcribe(path,offset,return_metadata=False):
    global PROC
    with LOCK:
        try:
            if PROC is None or PROC.poll() is not None:
                if PROC is not None:close()
                with (W/'logs/audio-worker.log').open('a') as log:
                    PROC=subprocess.Popen([sys.executable,'-u',str(Path(__file__).parent/'audio_worker.py')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,env={**os.environ,'HF_HOME':str(W/'cache/huggingface'),'HF_HUB_OFFLINE':'1','CUDA_VISIBLE_DEVICES':'','OMP_NUM_THREADS':'8','PYTHONDONTWRITEBYTECODE':'1'})
                if read_line(120)!='READY':raise ValueError('Speech model failed to initialize')
            PROC.stdin.write(json.dumps({'path':str(path)})+'\n');PROC.stdin.flush();r=json.loads(read_line(300))
            if 'error' in r:raise ValueError(r['error'])
            for s in r['segments']:
                s['start']=round(s['start']+offset,3);s['end']=round(s['end']+offset,3)
                for w in s['words']:w['start']=round(w['start']+offset,3);w['end']=round(w['end']+offset,3)
            return r if return_metadata else r['segments']
        except BaseException:close();raise
