import {randomUUID} from 'node:crypto';
export async function withMediaLease(scheduler, backend, signal, work) {
 if(!scheduler||!backend)return work(signal);
 const key='dsh-media:'+randomUUID(),owner=new AbortController();
 let pending,settled=false;
 const lease=await scheduler.acquire({key,name:'Media analysis',gpu:backend.gpu??0,fingerprint:key,
  load:async()=>null,unload:async()=>{if(!settled){owner.abort(Error('Media GPU ownership ended'));if(pending)await pending.catch(()=>{});}}},signal);
 try{
  pending=work(AbortSignal.any([signal,lease.signal,owner.signal]));
  return await pending;
 }finally{
  settled=true;lease.release();await scheduler.unload(key);
 }
}
