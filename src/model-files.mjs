import {opendir, realpath, stat} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, sep} from 'node:path';

async function absoluteDirectory(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || /[\r\n\0]/.test(path)) {
    throw Error('Choose an absolute folder path on the Harness host.');
  }
  const root = await realpath(path);
  if (!(await stat(root)).isDirectory()) throw Error('Choose a folder.');
  return root;
}

export async function browseFolders(path) {
  const root = await absoluteDirectory(path || process.env.HOME || process.env.USERPROFILE);
  const entries = [];
  for await (const entry of await opendir(root)) {
    if (entry.isDirectory()) entries.push({name: entry.name, path: join(root, entry.name)});
    if (entries.length >= 1500) break;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return {path: root, parent: dirname(root), entries};
}

export async function modelFiles(path, names) {
  const root = await absoluteDirectory(path);
  const files = new Map();
  const seen = new Set();
  let inspected = 0, unreadable = 0, skippedLinks = 0;

  async function walk(directory, depth) {
    if (seen.has(directory)) return;
    if (depth > 32) throw Error('This scan would exceed 32 nested folders. Choose a narrower folder.');
    seen.add(directory);
    try {
      for await (const entry of await opendir(directory)) {
        if (++inspected > 50000) throw Error('This scan would exceed 50,000 entries. Choose a narrower folder.');
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(path, depth + 1);
          continue;
        }
        if ((!entry.isFile() && !entry.isSymbolicLink()) || !names.has(entry.name)) continue;
        try {
          const target = entry.isSymbolicLink() ? await realpath(path) : path;
          const rel = relative(root, target);
          if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) {
            skippedLinks++;
            continue;
          }
          const info = await stat(target);
          if (!info.isFile()) continue;
          const matches = files.get(entry.name) || new Map();
          matches.set(target, {path: target, bytes: info.size});
          files.set(entry.name, matches);
        } catch (error) {
          if (!['ENOENT', 'EACCES', 'EPERM', 'ELOOP'].includes(error.code)) throw error;
          unreadable++;
        }
      }
    } catch (error) {
      if (directory === root || !['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      unreadable++;
    }
  }

  await walk(root, 0);
  const warnings = [];
  if (unreadable) warnings.push(`${unreadable} files or folders could not be read.`);
  if (skippedLinks) warnings.push(`${skippedLinks} links pointed outside the selected folder.`);
  return {root, files, warnings};
}

export function matchFile(files, {name, size}) {
  const candidates = [...(files.get(name)?.values() || [])].filter(file => file.bytes === size);
  if (candidates.length === 1) return {path: candidates[0].path};
  const state = candidates.length ? 'multiple exact-size candidates' : files.has(name) ? 'size mismatch' : 'missing';
  return {issue: name + ' (' + state + ')'};
}
