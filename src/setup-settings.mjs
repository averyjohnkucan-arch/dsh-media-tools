import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {configPath, loadConfig, readSavedConfig} from './config.mjs';
import {matchFile, modelFiles} from './model-files.mjs';
import {installNativeRuntime} from './runtime-assets.mjs';
import {doctor} from './core.mjs';
import {run} from './process.mjs';

const omniFiles = {
  omni_model: {name:'Qwen3-Omni-30B-A3B-Captioner-Q4_K_M.gguf', size:18557053312},
  omni_projector: {name:'mmproj-Qwen3-Omni-30B-A3B-Captioner-BF16.gguf', size:2207465728},
};
const whisperFiles = ['model.bin', 'config.json', 'tokenizer.json'];

export async function scanModels(folder) {
  const names = new Set([...whisperFiles, ...Object.values(omniFiles).map(file => file.name)]);
  const {files, warnings} = await modelFiles(folder, names);
  const paths = {}, issues = [];
  for (const [role, file] of Object.entries(omniFiles)) {
    const result = matchFile(files, file);
    if (result.path) paths[role] = result.path;
    else issues.push(result.issue);
  }

  const whisper = [];
  for (const file of files.get('model.bin')?.values() || []) {
    if (file.bytes < 50 * 1024 ** 2) continue;
    const folder = path.dirname(file.path);
    const config = files.get('config.json')?.get(path.join(folder, 'config.json'));
    if (!config || config.bytes > 4 * 1024 ** 2 ||
        !files.get('tokenizer.json')?.has(path.join(folder, 'tokenizer.json'))) continue;
    try {
      const metadata = JSON.parse(await fs.readFile(config.path, 'utf8'));
      if ('suppress_ids' in metadata || 'lang_ids' in metadata) whisper.push(folder);
    } catch (error) {
      if (!(error instanceof SyntaxError) && !['ENOENT','EACCES','EPERM'].includes(error.code)) throw error;
    }
  }

  return {paths, issues, whisper, warnings};
}

async function saveSettings(change) {
  const file = configPath();
  const next = {...await readSavedConfig(), ...change};
  await fs.mkdir(path.dirname(file), {recursive:true, mode:0o700});
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', {flag:'wx', mode:0o600});
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, {force:true});
  }
}

export function createSetupActions(signal) {
  let busy = false;
  return async (action, payload = {}) => {
    if (action === 'status') {
      const cfg = await loadConfig();
      return {models:cfg.models || {}, whisperModel:cfg.whisperModel || '', ...await doctor()};
    }
    if (action === 'scan') return scanModels(payload.path);
    if (busy) throw Error('Media settings are already being updated.');
    busy = true;
    try {
      if (action === 'saveModels') {
        const {paths, whisper} = await scanModels(payload.folder);
        const change = {};
        const cfg = await readSavedConfig();
        if (paths.omni_model && paths.omni_projector && payload.useOmni === true) {
          change.models = {...cfg.models, omni:paths};
          if (cfg.backend) change.backend = {...cfg.backend, ...paths};
        }
        if (payload.whisper && whisper.includes(payload.whisper)) {
          change.whisperModel = payload.whisper;
          if (cfg.backend) change.backend = {...(change.backend || cfg.backend), whisper_model:payload.whisper};
        }
        if (!Object.keys(change).length) throw Error('Select a detected model set to save.');
        await saveSettings(change);
        return {saved:true};
      }
      if (action === 'setupDecoder') {
        const file = configPath();
        if ((await readSavedConfig()).backend) throw Error('The existing native worker needs its current Python environment.');
        const directory = path.join(path.dirname(file), 'runtime');
        await fs.mkdir(directory, {recursive:true, mode:0o700});
        const venv = await fs.mkdtemp(path.join(directory, 'decoder-'));
        const launcher = process.env.DSH_MEDIA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
        const python = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
        try {
          await run(launcher, [
            fileURLToPath(new URL('../python/setup_decoder.py', import.meta.url)), directory, venv,
            fileURLToPath(new URL('../requirements.txt', import.meta.url)),
          ], {signal,timeout:900000});
          const current = await readSavedConfig();
          // A configured native backend can require additional CUDA libraries in its own venv.
          if (!current.backend) await saveSettings({python});
          else throw Error('The existing native worker needs its current Python environment.');
        } catch (error) {
          await fs.rm(venv, {recursive:true, force:true});
          throw error;
        }
        return {installed:true};
      }
      if (action === 'setupOmni') {
        const cfg = await readSavedConfig();
        if (cfg.backend) throw Error('An Omni or native video backend is already configured.');
        if (!cfg.models?.omni?.omni_model || !cfg.models.omni.omni_projector || !cfg.whisperModel || !cfg.python) {
          throw Error('Save the Omni and Whisper models and install the audio analysis runtime first.');
        }
        for (const file of [cfg.models.omni.omni_model, cfg.models.omni.omni_projector, path.join(cfg.whisperModel,'model.bin')]) {
          await fs.access(file);
        }
        const directory = path.join(path.dirname(configPath()),'runtime');
        const runtime = path.join(directory,'native-cuda13');
        const llama_server = path.join(runtime,'omni','llama-server');
        try { await fs.access(path.join(runtime,'runtime-receipt.json'));await fs.access(llama_server); }
        catch { await installNativeRuntime(runtime); }
        signal.throwIfAborted();
        await run(cfg.python, ['-m','ensurepip'], {signal,timeout:120000});
        await run(cfg.python, ['-m','pip','install','--disable-pip-version-check','-r',fileURLToPath(new URL('../requirements-cuda.txt',import.meta.url))], {signal,timeout:600000});
        await saveSettings({backend:{
          schema:1, cacheDirectory:runtime, libraryDirs:[path.join(runtime,'omni')],
          llama_server, ...cfg.models.omni, whisper_model:cfg.whisperModel, gpu:0,
          cpu_threads:8, cpu_moe_layers:18, max_tokens:8192, context:9216, temperature:0.6,
        }});
        return {installed:true};
      }
      throw Error('Unknown media settings action.');
    } finally { busy = false; }
  };
}
