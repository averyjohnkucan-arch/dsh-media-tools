import {installPlugin} from './plugin.mjs';
export const name = 'dsh-media-video';
export const inject = ['tools','attachments','systemPrompt'];
export function apply(ctx, config) { installPlugin(ctx, 'video', config); }
