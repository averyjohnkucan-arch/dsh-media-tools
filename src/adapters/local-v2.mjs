import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
// Compatibility adapter deliberately reuses V2's scheduler, sandbox and lease singleton.
// This optional adapter is Linux-only; the independent CPU tools do not import V2.
export async function localV2(request, config, signal) {
  if (process.platform !== 'linux') throw Error('The Local AI v2 adapter requires Linux; configure a portable command backend on this platform');
  const root = await fs.realpath(config.localAIV2Root);
  const load = rel => import(pathToFileURL(path.join(root, rel)).href);
  const [{workspaceProcess}, {captionRequest}, {sessionLeases}] = await Promise.all([
    load('modules/sandbox/process.mjs'), load('modules/old-tools/caption-audio/index.mjs'), load('modules/transport/headers.mjs')
  ]);
  const video = request.operation === 'analyze_video';
  const box = await workspaceProcess(request.workspace, {sessionId: request.sessionId, name: video ? 'native-video' : 'caption-audio'});
  const dir = await fs.mkdtemp(path.join(box.temporaryDirectory, video ? 'video-tool-' : 'audio-tool-'));
  try {
    const source = path.join(dir, video ? 'source.mp4' : 'source' + path.extname(request.source));
    await fs.copyFile(request.source, source);
    const control = JSON.parse(await fs.readFile(path.join(root, 'config/router.json'), 'utf8'));
    const reply = await captionRequest(`http://127.0.0.1:${control.port}/__background/${video ? 'native-video' : 'audio-caption'}`, source, signal, {
      body: {workspace: request.workspace, sessionId: request.sessionId, ...(video ? {question: request.question} : {})},
      headers: {'x-background-secret': control.secret, ...sessionLeases.toolHeaders(request.sessionId)}
    });
    if (reply.result_file !== path.join(dir, 'result.json') && !( !video && reply.result_file && path.dirname(reply.result_file) === dir)) throw Error('Invalid V2 result location');
    const real = await fs.realpath(reply.result_file);
    if (!real.startsWith(dir + path.sep)) throw Error('V2 result escapes job');
    const result = JSON.parse(await fs.readFile(real, 'utf8'));
    if (video) {
      if (result.mode !== 'native-temporal-video' || result.native_engine?.mrope !== true || !(result.native_engine?.video_pad_tokens > 0)) throw Error('Missing native temporal evidence');
      await fs.cp(path.join(dir, 'evidence'), path.join(request.output, 'evidence'), {recursive: true, dereference: true});
    }
    return result;
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
}
