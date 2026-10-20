import {run} from '../process.mjs';
export async function commandBackend(request, config, signal) {
  const spec = config.backends?.[request.operation];
  if (!spec?.command || !Array.isArray(spec.args)) throw Error(`Configure backends.${request.operation} with command and args, or set localAIV2Root. See docs/backends.md`);
  const text = await run(spec.command, spec.args, {cwd: request.workspace, signal, input: JSON.stringify(request) + '\n', timeout: 14400000});
  const result = JSON.parse(text);
  if (typeof result.text !== 'string' || !Number.isFinite(result.duration_seconds) || result.duration_seconds < 0) throw Error('Backend must return text and duration_seconds');
  if (request.operation === 'analyze_video' && (result.mode !== 'native-temporal-video' || result.native_engine?.mrope !== true || !(result.native_engine?.video_pad_tokens > 0))) throw Error('Video backend did not provide native temporal engine evidence');
  return result;
}
