#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {execute,doctor,operations} from './core.mjs';
const control = new AbortController();
process.once('SIGINT',() => control.abort(Error('Interrupted')));
process.once('SIGTERM',() => control.abort(Error('Terminated')));
try {
  const [operation,...argv] = process.argv.slice(2);
  if (operation === 'setup-backends') { process.argv = [process.argv[0],process.argv[1],...argv]; await import('./setup-backends.mjs'); }
  else if (operation === 'doctor') console.log(JSON.stringify(await doctor(),null,2));
  else if (!operation || operation === '--help') console.log(`dsh-media doctor\ndsh-media <${operations.join('|')}> --workspace <folder> --args '<JSON>'\nInstall skills: node src/install.mjs --help\nMCP: dsh-media-mcp --workspace <folder>`);
  else {
    const {values} = parseArgs({args:argv,options:{workspace:{type:'string'},args:{type:'string',default:'{}'}}});
    console.log(JSON.stringify(await execute(operation,JSON.parse(values.args),{workspace:values.workspace,signal:control.signal}),null,2));
  }
} catch(e) { console.error(e.message); process.exitCode = 1; }
