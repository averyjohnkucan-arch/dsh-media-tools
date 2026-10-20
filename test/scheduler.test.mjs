import test from 'node:test';
import assert from 'node:assert/strict';
import {withMediaLease} from '../src/scheduler.mjs';
test('media scheduler releases and unloads after success or failure',async()=>{
 for(const fails of [false,true]){
  const calls=[];let driver;
  const scheduler={async acquire(d,s){driver=d;calls.push('acquire');await d.load(s);return{signal:s,release(){calls.push('release');}};},async unload(key){assert.equal(key,driver.key);calls.push('unload');await driver.unload();}};
  const run=()=>withMediaLease(scheduler,{gpu:0},new AbortController().signal,async signal=>{calls.push('work');signal.throwIfAborted();if(fails)throw Error('fixture error');return 'complete';});
  if(fails)await assert.rejects(run(),/fixture error/);else assert.equal(await run(),'complete');
  assert.deepEqual(calls,['acquire','work','release','unload']);
 }
});
test('media scheduler preserves cancellation while waiting for admission',async()=>{
 const c=new AbortController();c.abort(Error('cancelled before load'));
 const scheduler={async acquire(_d,s){s.throwIfAborted();},async unload(){throw Error('must not unload a lease never granted');}};
 await assert.rejects(withMediaLease(scheduler,{gpu:0},c.signal,()=>{throw Error('must not execute');}),/cancelled before load/);
});
