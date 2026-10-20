import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
export const configPath = () => process.env.DSH_MEDIA_CONFIG || path.join(os.homedir(), '.config', 'dsh-media', 'config.json');
export async function loadConfig(overrides = {}) {
  let saved = {};
  try { saved = JSON.parse(await fs.readFile(configPath(), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const require = createRequire(import.meta.url);
  let ffmpeg = 'ffmpeg', ffprobe = 'ffprobe';
  try { ffmpeg = require('ffmpeg-static') || ffmpeg; } catch {}
  try { ffprobe = require('@ffprobe-installer/ffprobe').path; } catch {}
  return { python: process.env.DSH_MEDIA_PYTHON || 'python3', ffmpeg, ffprobe, ...saved, ...overrides };
}
