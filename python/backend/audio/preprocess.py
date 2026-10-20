"""Portable audio decoding and time windows shared by caption providers."""
import hashlib,json,math,os,subprocess
from pathlib import Path
ROOT=Path(__file__).parent
WORKSPACE=Path(os.environ['PROD_WORKSPACE']).resolve(strict=True)
JOB=Path(os.environ['PROD_MEDIA_JOB']).resolve(strict=True)
POLICY=['-protocol_whitelist','file,pipe','-format_whitelist','wav,mp3,flac,ogg,mov,matroska,webm,aac,aiff,asf,ape,ac3,eac3,opus,amr']
def run(tool,args,timeout=120):
 tool=os.environ.get('DSH_MEDIA_'+tool.upper(),tool)
 result=subprocess.run([tool,*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
 if result.returncode:raise ValueError(tool+' failed: '+result.stderr.decode(errors='replace')[-3000:])
 return result.stdout

def inspect(source,allowed_root):
 base=Path(allowed_root).resolve(strict=True);path=Path(source).resolve(strict=True)
 if not base.is_relative_to(JOB) or not path.is_relative_to(base) or not path.is_file():raise ValueError('Audio source must be a file inside its chat staging directory')
 probe=json.loads(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',*POLICY,str(path)]))
 streams=[stream for stream in probe.get('streams',[]) if stream.get('codec_type')=='audio']
 if not streams:raise ValueError('No audio stream')
 duration=float(streams[0].get('duration') or probe.get('format',{}).get('duration') or 0)
 if not math.isfinite(duration) or not 0<duration<=14400:raise ValueError('Audio duration must be known and no longer than four hours')
 with path.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
 return {'source':str(path),'source_sha256':digest,'stream':streams[0]['index'],'duration_seconds':duration}

def windows(duration,core=26,padding=2):
 if not math.isfinite(duration) or not 0<duration<=14400:raise ValueError('Invalid duration')
 if core!=26 or padding!=2:raise ValueError('Qualified audio windows use 26-second cores and 2-second padding')
 return [{'index':index,'core_start':index*core,'core_end':min(duration,(index+1)*core),
          'audio_start':max(0,index*core-padding),'audio_end':min(duration,(index+1)*core+padding)}
         for index in range(math.ceil(duration/core))]

def extract(manifest,window,output):
 path=Path(output).absolute()
 if not path.parent.resolve(strict=True).is_relative_to(JOB):raise ValueError('Decoded audio must stay inside the chat job')
 if path.exists() or path.is_symlink():raise FileExistsError(path)
 # No overwrite, remote protocols, video decoding, or implicit channel selection.
 run('ffmpeg',['-nostdin','-v','error','-n',*POLICY,'-ss',str(window['audio_start']),'-i',manifest['source'],
               '-t',str(window['audio_end']-window['audio_start']),'-map','0:'+str(manifest['stream']),'-vn',
               '-af','aresample=async=1:first_pts=0,apad','-ac','1','-ar','16000','-c:a','pcm_s16le',str(path)])
 return path
