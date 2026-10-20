"""Run the preserved temporal video pipeline in a scheduler-owned workspace job.

The included worker supplies a private short-path job directory, avoiding whitespace
in the ENCV/GENI line protocol without moving user files or model assets.
"""
import contextlib
import json
import os
from pathlib import Path
import signal
import shutil
import struct
import sys
import threading
import time

ROOT = Path(__file__).parent.parent
JOB = Path(os.environ['DSH_MEDIA_JOB'])
BACKEND = json.loads(os.environ['DSH_MEDIA_BACKEND_CONFIG'])
SUPPORT = ROOT


def analyze():
    started = time.monotonic()
    request = json.loads((JOB / 'request.json').read_text())
    question = request['question']
    if not isinstance(question, str) or not question.strip() or len(question) > 12000:
        raise ValueError('A video question of at most 12000 characters is required')
    source = JOB / 'source.mp4'
    if not source.is_file():
        raise ValueError('A staged video source is required')
    for name in ('tmp', 'state', 'evidence', 'logs', 'cache', 'media', 'omni/logs'):
        (JOB / name).mkdir(parents=True, exist_ok=True)
    os.environ.update(VIDEO_RUNTIME_ROOT=str(JOB), VIDEO_ATTACHMENTS_ROOT=str(JOB),
                      VIDEO_SUPPORT_ROOT=str(SUPPORT), VIDEO_OMNI_ROOT=str(JOB / 'omni'),
                      HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
                      STRATA_MEDIA_TRACE=str(JOB / 'evidence/native-engine.bin'))
    cancel = threading.Event()
    def stop(_sig, _frame):
        cancel.set()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    sys.path[:0] = [str(ROOT/'vendor'), str(ROOT/'vendor/tools')]
    from video_media import CONTEXT, prepare
    from audio_captioner import caption_all
    import video_audio
    from serve import server, frontend
    import strata_tokenizer as ST
    import video_backend
    CONTEXT.cancel = cancel
    profile = BACKEND['native']
    cfg = json.loads(json.dumps(profile['profile']))
    cfg['exe'] = profile['engine']
    cfg['cwd'] = str(JOB)
    cfg['vision']['exe'] = profile['encoder']
    cfg['vision']['gpu'] = True
    cfg['args'][cfg['args'].index('--vram-reserve-mib') + 1] = '2048'
    cfg['log'] = str(JOB / 'logs/engine.log')
    # Never write the source checkout's expert-profile file.
    profile_index = cfg['args'].index('--expert-profile') + 1
    shutil.copyfile(cfg['args'][profile_index], JOB / 'state/expert-profile.bin')
    cfg['args'][profile_index] = str(JOB / 'state/expert-profile.bin')
    cfg['sampling'] = dict(temperature=.7, top_p=.8, top_k=20, min_p=0,
                           repetition_penalty=1, presence_penalty=1.5, frequency_penalty=0)
    config = JOB / 'state/model.json'
    config.write_text(json.dumps(cfg, indent=2))
    os.environ['VIDEO_MODEL_CONFIG'] = str(config)
    manifest = prepare(str(source))
    # Exactly the old two-stage ownership: Omni finishes before Flash loads.
    caption_all([manifest])
    if cancel.is_set():
        raise ValueError('Video analysis canceled')
    video_backend.install(server, frontend)
    server.Vision.work_dir = staticmethod(lambda: JOB / 'tmp/encoder')
    (JOB / 'tmp/encoder').mkdir(exist_ok=True)
    tpath = Path(cfg['tokenizer'])
    vocab = json.loads((tpath / 'vocab.json').read_text())
    tokens = [None] * len(vocab)
    for token, index in vocab.items():
        tokens[index] = token
    tok = ST.Tokenizer(tokens, (tpath / 'merges.txt').read_text().split('\n'),
                       json.loads((tpath / 'token_type.json').read_text()))
    engine = vision = None
    try:
        env = server.child_env(cfg)
        with (JOB / 'logs/vision.log').open('a') as log:
            vision = server.Vision(cfg['vision'], log=log, env=server.vision_env(cfg, env), lazy=True)
            engine = server.StrataEngine(cfg['exe'], cfg['args'], cwd=cfg['cwd'],
                                         log=cfg['log'], env=env, lazy=True)
            template = tpath / 'chat_template.jinja'
            if not template.exists():
                template = ROOT / 'vendor/serve/chat_template.jinja'
            svc = server.Service(engine, tok, server.ChatTemplate(template),
                                 model_name=profile['model_name'], vision=vision,
                                 sampling_defaults=cfg['sampling'], fit_max_tokens=True)
            svc.embeddings.cancel = cancel
            messages = [dict(role='user', content=[dict(type='text', text=question),
                        dict(type='video', source=str(source))])]
            ids, thinking, limit = svc.prepare(messages, None, {'enable_thinking': False}, 2048)
            answer, done = [], None
            for kind, value in svc.run(ids, thinking, None, limit, cfg['sampling'], cancel):
                if kind == 'event' and value.kind == 'content':
                    answer.append(value.text or '')
                elif kind == 'done':
                    done = value
            text = ''.join(answer).strip()
            if not text:
                raise ValueError('Native video returned no answer')
            trace = json.loads((JOB / 'evidence/last-native-request.json').read_text())
            if trace['mode'] != 'native-temporal-video' or trace['videoPadCount'] <= 0:
                raise ValueError('Missing native temporal video evidence')
            raw = (JOB / 'evidence/native-engine.bin').read_bytes()
            count, = struct.unpack_from('<i', raw)
            if len(raw) != 4 + 16 * count:
                raise ValueError('Invalid native engine M-RoPE trace')
            rows = list(struct.iter_unpack('<4i', raw[4:]))
            pads = [row for row in rows if row[0] == 248057]
            if len(pads) != trace['videoPadCount'] or not any(row[1] != row[2] or row[2] != row[3] for row in pads):
                raise ValueError('Native engine did not consume temporal M-RoPE positions')
            result = dict(text=text, duration_seconds=manifest['duration'],
                          mode='native-temporal-video', seconds=time.monotonic()-started,
                          native_request=trace, completion=done,
                          native_engine=dict(prompt_tokens=count, video_pad_tokens=len(pads), mrope=True))
            (JOB / 'result.json').write_text(json.dumps(result, indent=2))
            return dict(result_file=str(JOB / 'result.json'), duration_seconds=manifest['duration'],
                        mode=result['mode'])
    finally:
        if engine is not None:
            engine.close()
        if vision is not None:
            vision.close()
        video_audio.close()


if __name__ == '__main__':
    # Old progress printing belongs on stderr, never in the broker JSON protocol.
    with contextlib.redirect_stdout(sys.stderr):
        result = analyze()
    print((JOB/'result.json').read_text(), flush=True)
