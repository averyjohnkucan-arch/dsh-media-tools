"""One self-contained, scheduler-owned media job; V2 services are not used."""
import contextlib,json,os,runpy,shutil,signal,subprocess,sys,tempfile
from pathlib import Path

signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
request=json.loads(sys.stdin.readline())
backend=json.loads(os.environ['DSH_MEDIA_BACKEND_CONFIG'])
output=Path(request['output']).resolve(); output.mkdir(parents=True,exist_ok=True)
# Legacy ENCV/GENI records are space-delimited: a private short-path directory keeps
# workspace paths containing spaces valid without changing the user's files.
job=Path(os.environ['DSH_MEDIA_JOB_DIRECTORY'])
alias=job
lock=None
try:
    if sys.platform!='linux':raise RuntimeError('Bundled native runtime is currently qualified for Linux x64/CUDA 13 only')
    import fcntl
    lockroot=Path(backend['cacheDirectory']);lockroot.mkdir(parents=True,exist_ok=True)
    lock=(lockroot/'gpu.lock').open('a')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise RuntimeError('Another media GPU job is active; retry after it finishes')
    owners=subprocess.run(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],capture_output=True,text=True,check=True).stdout.strip()
    if owners:raise RuntimeError('GPU is owned by another model. Use the DSH modelScheduler integration or unload that model first; no unrelated process was stopped.')
    source=alias/('source.mp4' if request['operation']=='analyze_video' else 'source'+Path(request['source']).suffix)
    shutil.copyfile(request['source'],source)
    os.environ.update(PROD_WORKSPACE=str(alias),PROD_MEDIA_JOB=str(alias),PROD_MEDIA_SOURCE=str(source),
        DSH_MEDIA_JOB=str(alias),DSH_MEDIA_WHISPER_MODEL=backend['whisper_model'],
        HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',VIDEO_SUPPORT_ROOT=str(Path(__file__).parent))
    root=Path(__file__).parent
    if request['operation']=='analyze_video':
        for name in ('tmp','state','evidence','logs','cache','media','omni/logs'):(alias/name).mkdir(parents=True,exist_ok=True)
        (alias/'request.json').write_text(json.dumps({'question':request['question']}))
        sys.path.insert(0,str(root/'native'))
        with contextlib.redirect_stdout(sys.stderr):
            module=runpy.run_path(str(root/'native/job.py'),run_name='dsh_media_native')
            module['analyze']()
        result=json.loads((alias/'result.json').read_text())
        shutil.copytree(alias/'evidence',output/'evidence')
        shutil.copytree(alias/'logs',output/'logs')
    else:
        sys.path.insert(0,str(root/'audio'))
        with contextlib.redirect_stdout(sys.stderr):
            module=runpy.run_path(str(root/'audio/caption_worker.py'),run_name='dsh_media_audio')
            reply=module['analyze'](str(source))
        result=json.loads(Path(reply['result_file']).read_text())
    print(json.dumps(result,allow_nan=False),flush=True)
finally:
    shutil.rmtree(job,ignore_errors=True)
    if lock:lock.close()
