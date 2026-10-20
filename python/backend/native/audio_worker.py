"""CPU ASR with raw model confidence diagnostics, not correctness percentages."""
import json,sys,wave,math,os
import numpy as np
from pathlib import Path
from faster_whisper import WhisperModel
W=Path(os.environ['VIDEO_SUPPORT_ROOT'])
model=WhisperModel(os.environ['DSH_MEDIA_WHISPER_MODEL'],device='cpu',compute_type='int8',cpu_threads=8,num_workers=1,local_files_only=True)
def number(v):
 return float(v) if v is not None and math.isfinite(float(v)) else None
print('READY',flush=True)
for line in sys.stdin:
 try:
  request=json.loads(line)
  with wave.open(request['path'],'rb') as wav:
   if (wav.getnchannels(),wav.getsampwidth(),wav.getframerate())!=(1,2,16000):raise ValueError('Expected mono 16kHz PCM16 audio')
   samples=np.frombuffer(wav.readframes(wav.getnframes()),dtype='<i2').astype(np.float32)/32768.0
  segments,info=model.transcribe(samples,beam_size=5,vad_filter=True,condition_on_previous_text=False,word_timestamps=True)
  result=[]
  for s in segments:
   words=[{'start':w.start,'end':w.end,'text':w.word,'probability':number(w.probability)} for w in s.words or []]
   probs=[w['probability'] for w in words if w['probability'] is not None]
   scores={'avg_logprob':number(s.avg_logprob),'no_speech_prob':number(s.no_speech_prob),'compression_ratio':number(s.compression_ratio),'temperature':number(s.temperature),'mean_word_probability':sum(probs)/len(probs) if probs else None}
   flags=[]
   if scores['avg_logprob'] is not None and scores['avg_logprob']<-1:flags.append('low_token_likelihood')
   if scores['no_speech_prob'] is not None and scores['no_speech_prob']>.6:flags.append('high_no_speech_probability')
   if scores['compression_ratio'] is not None and scores['compression_ratio']>2.4:flags.append('repetitive_text')
   if scores['temperature'] is not None and scores['temperature']>0:flags.append('decoding_fallback_used')
   result.append({'start':s.start,'end':s.end,'text':s.text.strip(),'words':words,'confidence':scores,'diagnostic_flags':flags})
  print(json.dumps({'segments':result,'language':info.language,'language_probability':number(info.language_probability),'duration':number(info.duration),'duration_after_vad':number(info.duration_after_vad),'confidence_kind':'model_likelihoods_not_calibrated_correctness'},allow_nan=False),flush=True)
 except Exception as e:print(json.dumps({'error':str(e)}),flush=True)
