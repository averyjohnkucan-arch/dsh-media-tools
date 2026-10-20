import {installPlugin} from './plugin.mjs';
export const name = 'dsh-media-audio';
export const inject = ['tools','attachments','systemPrompt'];
export function apply(ctx, config) { installPlugin(ctx, 'audio', config); }
