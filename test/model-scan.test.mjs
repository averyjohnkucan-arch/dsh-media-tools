import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, open, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scanModels} from '../src/setup-settings.mjs';

test('Whisper discovery requires Whisper metadata and a tokenizer beside the weights', async t => {
  const root = await mkdtemp(join(tmpdir(),'media-discovery-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const dir = join(root,'speech','publisher','small');
  await mkdir(dir,{recursive:true});
  const file = await open(join(dir,'model.bin'),'w');
  await file.truncate(68 * 1024 ** 2);
  await file.close();
  await writeFile(join(dir,'config.json'),'{"suppress_ids":[1,2]}');
  assert.deepEqual((await scanModels(root)).whisper,[]);
  await writeFile(join(dir,'tokenizer.json'),'{}');
  assert.deepEqual((await scanModels(root)).whisper,[dir]);
});
