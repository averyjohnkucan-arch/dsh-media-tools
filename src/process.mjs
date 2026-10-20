import {spawn} from 'node:child_process';
// No shell interpolation. Every call waits for child termination before releasing scratch.
export function run(command, args, {signal, cwd, env = {}, input, timeout = 180000, maxBytes = 16 * 1024 ** 2} = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, env: {...process.env, ...env}, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32'});
    let out = [], size = 0, err = '', failure, escalation;
    const kill = (force) => {
      try { if (process.platform !== 'win32') process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM'); else child.kill(force ? 'SIGKILL' : 'SIGTERM'); } catch {}
    };
    const stop = (error) => { failure ??= error; kill(false); escalation ??= setTimeout(() => kill(true), 1500); };
    const abort = () => stop(signal.reason ?? Error('Cancelled'));
    const timer = setTimeout(() => stop(Error('Media worker timed out')), timeout);
    signal?.addEventListener('abort', abort, {once: true});
    child.stdout.on('data', b => { size += b.length; if (size > maxBytes) stop(Error('Media worker output limit exceeded')); else out.push(b); });
    child.stderr.on('data', b => { err = (err + b).slice(-8000); });
    child.on('error', e => { failure = e; });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(escalation); signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(Error(`Media worker exited ${code}: ${err}`));
      else resolve(Buffer.concat(out).toString('utf8'));
    });
    if (signal?.aborted) abort();
  });
}
