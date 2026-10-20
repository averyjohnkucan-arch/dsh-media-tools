#!/usr/bin/env node
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {execute} from './core.mjs';
import {definitions} from './definitions.mjs';
const {values} = parseArgs({options:{workspace:{type:'string'}}});
if (!values.workspace) throw Error('MCP requires --workspace <authorized folder>');
const workspace = await fs.realpath(values.workspace);
const shutdown = new AbortController();
const sessionId = 'mcp-' + randomUUID();
const server = new Server({name:'dsh-media-tools',version:'0.2.2'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema, async() => ({tools:definitions.map(d => ({name:d.name,description:d.description,inputSchema:{type:'object',properties:Object.fromEntries(Object.entries(d.parameters).filter(([k]) => k !== 'attachment_id').map(([k,{required,...v}]) => [k,v])),required:['source_path',...Object.entries(d.parameters).filter(([,v]) => v.required).map(([k]) => k)],additionalProperties:false}}))}));
server.setRequestHandler(CallToolRequestSchema, async(request, extra) => {
  try {
    const reply = await execute(request.params.name,request.params.arguments || {}, {workspace,sessionId,signal:AbortSignal.any([shutdown.signal,extra.signal])});
    const content = [{type:'text',text:JSON.stringify(reply)}];
    for (const a of reply.artifacts.filter(a => a.mimeType.startsWith('image/'))) content.push({type:'image',data:(await fs.readFile(path.join(workspace,a.path))).toString('base64'),mimeType:a.mimeType});
    return {content};
  } catch(e) { return {isError:true,content:[{type:'text',text:e.message}]}; }
});
for (const event of ['SIGINT','SIGTERM']) process.once(event,async() => { shutdown.abort(Error('MCP server stopped')); await server.close(); });
await server.connect(new StdioServerTransport());
