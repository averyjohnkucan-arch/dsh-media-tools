import fs from 'node:fs/promises';
import {withMediaLease} from './scheduler.mjs';
import {loadConfig} from './config.mjs';
import path from 'node:path';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {execute} from './core.mjs';
import {definitions, guides} from './definitions.mjs';
import {safeDirectory, selectAttachment} from './files.mjs';
export function installPlugin(ctx, kind, config = {}) {
  const shutdown = new AbortController();
  // Cordis disposes registrations and prompt sections with this plugin scope.
  const active = new Set();
  ctx.effect(() => async () => {
    shutdown.abort(Error('Media plugin disabled'));
    await Promise.allSettled([...active]);
  });
  ctx.systemPrompt.section({name:`dsh-media-${kind}`,order:kind === 'audio' ? 2940 : 2941,interpolate:false,text:guides[kind]});
  for (const definition of definitions.filter(d => d.kind === kind)) {
    ctx.tools.register(defineTool({
      name:definition.name, description:definition.description, parameters:definition.parameters,
      timeoutMs:14400000, isConcurrencySafe:() => false,
      output:{schema:{type:'object',additionalProperties:true},render:(_args,r) => [
        {type:'text',text:JSON.stringify({result:r.result,artifacts:r.artifacts,display_markdown:r.display_markdown})},
        ...r.images.map(attachment => ({type:'image',attachment})),
        ...r.files.map(attachment => ({type:'file',attachment}))
      ]},
      async execute(args, exec) {
        if (!exec.agent) throw Error('An active conversation is required');
        if (args.source_path && args.attachment_id) throw Error('Choose source_path or attachment_id');
        let signal = exec.signal ? AbortSignal.any([exec.signal,shutdown.signal]) : shutdown.signal;
        const workspace = await fs.realpath(exec.agent.session.header.cwd);
        let staging;
        try {
          const input = {...args};
          if (!input.source_path) {
            const ref = selectAttachment(exec.agent.session.snapshotEvents(), input.attachment_id, kind);
            const root = await safeDirectory(workspace, '.dsh-media');
            staging = await fs.mkdtemp(path.join(root, 'upload-'));
            const source = path.join(staging, 'input' + path.extname(ref.name || '.bin'));
            const file = await fs.open(source, 'wx', 0o600); let bytes = 0;
            try { for await (const chunk of ctx.attachments.readFileStream(ref, signal)) {
              signal.throwIfAborted(); bytes += chunk.length;
              if (bytes > 2 * 1024 ** 3) throw Error('Media exceeds 2 GiB');
              await file.writeFile(chunk);
            }} finally { await file.close(); }
            input.source_path = path.relative(workspace, source);
          }
          const resolved=await loadConfig(config);
          const scheduler=ctx.get('modelScheduler');
          const gpuOperation=['listen_audio','analyze_video'].includes(definition.name)&&resolved.backend;
          const pending=withMediaLease(scheduler,gpuOperation?resolved.backend:null,signal,
            ownedSignal=>execute(definition.name,input,{workspace,sessionId:String(exec.agent.session.id),signal:ownedSignal,config}));
          active.add(pending);
          let reply;
          try { reply=await pending; } finally { active.delete(pending); }
          const images = [], files = [];
          for (const artifact of reply.artifacts) {
            signal.throwIfAborted();
            const data = await fs.readFile(path.join(workspace, artifact.path));
            if (artifact.mimeType.startsWith('image/')) images.push(await ctx.attachments.saveImage({data,mediaType:artifact.mimeType,name:path.basename(artifact.path)}));
            else files.push(await ctx.attachments.saveFile({data,name:path.basename(artifact.path)}));
          }
          return {...reply,images,files};
        } finally { if (staging) await fs.rm(staging,{recursive:true,force:true}); }
      }
    }));
  }
}
