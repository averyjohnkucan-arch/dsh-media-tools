import {randomBytes, timingSafeEqual} from 'node:crypto';
import {browseFolders} from './model-files.mjs';
import {createSetupActions} from './setup-settings.mjs';

export const name = 'dsh-media-settings';
export const inject = ['webServer'];

export function apply(ctx) {
  const abort = new AbortController();
  const path = '/plugins/dsh-media-tools/settings';
  const connection = {path, token:randomBytes(32).toString('hex')};
  const actionHandler = createSetupActions(abort.signal);
  ctx.effect(() => () => abort.abort(Error('Media settings plugin disabled.')));
  ctx.on('webserver/index-inject', items => items.push({kind:'global', name:'__DSH_MEDIA_TOOLS__', value:connection}));
  ctx.inject(['connection'], scope => scope.effect(() => ctx.webServer.register({
    kind:'exact', path:path + '/connection',
    handler(req,res) {
      res.setHeader('Cache-Control','no-store');
      if (req.method !== 'GET' || req.headers.origin && req.headers.origin !== ctx.webServer.getOrigin()) {
        res.writeHead(403);res.end();return;
      }
      if (!scope.connection.authorizeIndex(req,res)) return;
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify(connection));
    },
  })));
  ctx.effect(() => ctx.webServer.register({
    kind:'exact', path,
    async handler(req,res) {
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Type','application/json');
      const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /,''));
      const token = Buffer.from(connection.token);
      if (supplied.length !== token.length || !timingSafeEqual(supplied, token)) {
        res.writeHead(401);res.end(JSON.stringify({error:'Owner capability required.'}));return;
      }
      if (req.method !== 'POST' || !String(req.headers['content-type']).startsWith('application/json') ||
          req.headers.origin && req.headers.origin !== ctx.webServer.getOrigin()) {
        res.writeHead(403);res.end('{}');return;
      }
      try {
        let bytes = 0;
        const body = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 65536) throw Error('Request too large.');
          body.push(chunk);
        }
        const {action,payload = {}} = JSON.parse(Buffer.concat(body));
        const result = action === 'browse' ? await browseFolders(payload.path) : await actionHandler(action,payload);
        res.end(JSON.stringify({result}));
      } catch (error) {
        res.writeHead(400);res.end(JSON.stringify({error:error.message}));
      }
    },
  }));
}
