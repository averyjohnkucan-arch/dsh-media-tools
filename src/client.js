window.__ModuleLoader__.load({id:'dsh-media-tools',factory(require) {
  const React = require('react');
  const {createElement:h, useState, useEffect} = React;
  let connection = window.__DSH_MEDIA_TOOLS__;
  async function request(action,payload = {},retry = true) {
    if (!connection) {
      const response = await fetch('/plugins/dsh-media-tools/settings/connection');
      if (!response.ok) throw Error('Media Tools settings are unavailable.');
      connection = await response.json();
    }
    const response = await fetch(connection.path, {
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:'Bearer ' + connection.token},
      body:JSON.stringify({action,payload}),
    });
    if (response.status === 401 && retry) {
      connection = null;
      return request(action,payload,false);
    }
    const value = await response.json();
    if (!response.ok) throw Error(value.error || 'Media Tools settings request failed.');
    return value.result;
  }

  const labels = {
    ffmpeg:'Audio/video decoder', ffprobe:'Container and stream inspector', dsp:'Audio analysis',
    whisper:'Whisper speech transcription', listen_backend:'Omni audio interpretation',
    native_video_backend:'Native temporal video interpretation',
  };

  function Setup() {
    const [status,setStatus] = useState(null), [folder,setFolder] = useState('');
    const [browse,setBrowse] = useState(null), [scan,setScan] = useState(null);
    const [whisper,setWhisper] = useState(''), [error,setError] = useState('');
    const [notice,setNotice] = useState(''), [busy,setBusy] = useState(false);
    const [catalog,setCatalog] = useState(null), [showDownloads,setShowDownloads] = useState(false);
    const omni = Boolean(scan?.paths.omni_model && scan?.paths.omni_projector);
    useEffect(() => { request('status').then(setStatus,e => setError(e.message)); },[]);
    useEffect(() => {
      if (!showDownloads) return;
      let mounted = true;
      const refresh = () => request('recommended').then(value => mounted && setCatalog(value)).catch(error => mounted && setError(error.message));
      void refresh();
      const timer = setInterval(refresh,1500);
      return () => { mounted = false;clearInterval(timer); };
    },[showDownloads]);
    async function work(operation) {
      setBusy(true);setError('');setNotice('');
      try { await operation(); } catch (error) { setError(error.message); }
      finally { setBusy(false); }
    }
    const openFolder = path => work(async () => {
      const result = await request('browse',{path});
      setFolder(result.path);setBrowse(result);
    });
    return h('section',{style:{display:'grid',gap:12}},
      h('h2',null,'Media Tools'),
      error && h('p',{role:'alert'},error),
      notice && h('p',{role:'status'},notice),
      h('label',null,'Models folder on the Harness host',h('input',{
        style:{width:'100%'},value:folder,placeholder:'/path/to/Models',
        onChange:event=>{setFolder(event.target.value);setScan(null);},
      })),
      h('div',null,
        h('button',{disabled:busy,onClick:()=>openFolder(folder)},'Browse folders'),
        h('button',{disabled:busy||!folder.trim(),onClick:()=>work(async()=>{
          const result = await request('scan',{path:folder});
          setScan(result);setWhisper(result.whisper.length===1 ? result.whisper[0] : '');setBrowse(null);
        })},'Scan folder and subfolders')),
      browse && h('div',{style:{maxHeight:180,overflow:'auto'}},
        h('button',{disabled:busy,onClick:()=>openFolder(browse.parent)},'Up'),
        h('button',{onClick:()=>setBrowse(null)},'Close folders'),
        ...browse.entries.map(entry=>h('button',{key:entry.path,disabled:busy,onClick:()=>openFolder(entry.path)},entry.name))),
      scan && h('div',null,
        h('p',null,omni ? 'Found Qwen3 Omni Captioner Q4 and its BF16 projector. Audio interpretation also needs Whisper and a compatible Omni runtime.' :
          'Omni Captioner set incomplete. ' + scan.issues.join(', ')),
        ...scan.warnings.map(warning=>h('p',{key:warning},warning)),
        scan.whisper.length ? h('label',null,'Whisper model',h('select',{value:whisper,onChange:event=>setWhisper(event.target.value)},
          h('option',{value:''},'Choose a model'),
          ...scan.whisper.map(path=>h('option',{value:path,key:path},path)))) : h('p',null,'No local faster-whisper model directory found.'),
        h('button',{disabled:busy||!omni&&!whisper,onClick:()=>work(async()=>{
          await request('saveModels',{folder,useOmni:omni,whisper});setNotice('Model selections saved.');
          setStatus(await request('status'));
        })},'Save detected models')),
      h('details',{onToggle:event=>setShowDownloads(event.currentTarget.open)},
        h('summary',null,'Download models from Hugging Face'),
        showDownloads && !catalog && h('p',null,'Loading pinned models…'),
        ...((catalog?.models || []).filter(model=>model.files.every(file=>file.downloadable)).map(model=>{
          const job = catalog.jobs.findLast(job=>job.modelId===model.id);
          const total = model.files.reduce((sum,file)=>sum+file.size,0);
          const downloading = catalog.jobs.some(job=>job.status==='running');
          return h('div',{key:model.id,style:{paddingBlock:8}},
            h('strong',null,model.name+' · '+(total/1024**3).toFixed(2)+' GiB'),
            job&&h('p',{role:'status'},job.progress+' · '+Math.round(100*job.received/job.total)+'%'),
            h('button',{disabled:busy||downloading,onClick:()=>work(async()=>{
              await request('recommendedDownload',{id:model.id});setCatalog(await request('recommended'));
            })},'Download '+model.name),
            job?.status==='running'&&h('button',{disabled:busy,onClick:()=>work(async()=>setCatalog(await request('recommendedCancel',{id:job.id})))},'Cancel'),
            job?.status==='complete'&&h('button',{disabled:busy,onClick:()=>work(async()=>{
              await request('useDownload',{id:job.id});setNotice('Model selection saved.');setStatus(await request('status'));
            })},'Use downloaded model'));
        }))),
      h('div',null,
        h('h3',null,'Runtime status'),
        status?.models?.omni && h('p',null,'Omni Captioner model and projector saved.'),
        status?.whisperModel && h('p',null,'Whisper model saved.'),
        status && h('ul',null,...Object.entries(labels).map(([key,label])=>{
          const check = status.checks[key];
          const state = check.ok ? (check.requires_live_qualification ? 'paths ready, inference untested' : 'ready') :
            (check.error || 'setup needed');
          return h('li',{key},label + ' · ' + state);
        })),
        h('button',{disabled:busy,onClick:()=>work(async()=>setStatus(await request('status')))},'Check runtime'),
        status?.platform === 'linux' && status.models?.omni && status.whisperModel && status.checks.dsp.ok && !status.checks.listen_backend.configured &&
          h('button',{disabled:busy,onClick:()=>work(async()=>{
            await request('setupOmni');setNotice('Omni audio runtime installed.');
            setStatus(await request('status'));
          })},'Install Omni audio runtime'),
        status && !status.checks.dsp?.ok && h('button',{disabled:busy,onClick:()=>work(async()=>{
          await request('setupDecoder');setNotice('Audio analysis and transcription dependencies installed.');
          setStatus(await request('status'));
        })},'Install audio analysis runtime')));
  }

  return {inject:['slots'],apply(ctx) {
    ctx.slots.inject('settings.section',()=>ctx.slots.register({
      name:'settings.section',id:'media-tools',order:68,label:()=> 'Media Tools',
    },Setup));
  }};
}});
