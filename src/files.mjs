import fs from 'node:fs/promises';
import path from 'node:path';
export const inside = (root, file) => file.startsWith(root + path.sep);
export async function sourceFile(workspace, name) {
  if (typeof name !== 'string' || !name || path.isAbsolute(name) || name.split(/[\\/]/).includes('..')) throw Error('Use a workspace-relative source path');
  const file = await fs.realpath(path.resolve(workspace, name));
  if (!inside(workspace, file)) throw Error('Source escapes workspace');
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 2 * 1024 ** 3) throw Error('Source must be a regular file of at most 2 GiB');
  return file;
}
export async function safeDirectory(workspace, name) {
  let current = workspace;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    try { await fs.mkdir(current); } catch(e) { if (e.code !== 'EEXIST') throw e; }
    if (!inside(workspace, await fs.realpath(current))) throw Error('Output directory escapes workspace through a symlink');
  }
  return current;
}
export function selectAttachment(events, id, kind) {
  const match = kind === 'video' ? /\.(mp4|mov|m4v|mkv|webm|avi|mpeg|mpg|ts|gif|flv|asf)$/i : /\.(wav|mp3|flac|ogg|opus|m4a|aac|aiff?|wma|ape|ac3|amr|webm|mp4|mov|m4v|mkv)$/i;
  const known = new Map(); let latest = [];
  function walk(v, found) {
    if (!v || typeof v !== 'object') return;
    if (v.type === 'file' && v.attachment?.attachmentId && match.test(v.attachment.name || '')) found.push(v.attachment);
    else for (const x of Object.values(v)) walk(x, found);
  }
  for (const event of events) {
    if (!['user/message', 'tool/result'].includes(event.type)) continue;
    const found = []; walk(event.data, found);
    if (found.length) latest = [...new Map(found.map(r => [r.attachmentId, r])).values()];
    for (const ref of found) known.set(ref.attachmentId, ref);
  }
  if (id) { const ref = known.get(id) || known.get('sha256:' + id); if (!ref) throw Error('Unknown attachment ID'); return ref; }
  if (latest.length !== 1) throw Error(latest.length ? 'Choose an attachment_id for multiple uploads' : 'Attach a media file or supply source_path');
  return latest[0];
}
