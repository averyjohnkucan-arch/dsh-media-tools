import {RecommendedModels} from './recommended-models.mjs';
import {resolve} from 'node:path';
const [action='list',id,directory]=process.argv.slice(2);
const models=new RecommendedModels(new URL('./recommended-models.json',import.meta.url),resolve(directory||'models'));
try{
 if(action==='list')console.log(JSON.stringify(await models.list(),null,2));
 else if(action==='download'){
  await models.action('recommendedDownload',{id});
  const timer=setInterval(()=>{for(const job of models.jobs.values())console.error(job.progress+' · '+job.received+' / '+job.total+' bytes');},2000);
  try{await Promise.all([...models.jobs.values()].map(j=>j.promise));}finally{clearInterval(timer);}
  const job=(await models.list()).jobs.at(-1);console.log(JSON.stringify(job,null,2));if(job.status!=='complete')process.exitCode=1;
 }else throw Error('Usage: npm run models -- list | download MODEL_ID DIRECTORY');
}catch(e){console.error(e.message);process.exitCode=1;}finally{await models.dispose();}
