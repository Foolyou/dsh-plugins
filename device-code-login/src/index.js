import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Requests } from './state.js';
import { socketPath, startSocket } from './socket.js';
import { loginPage } from './page.js';
export const name = 'device-code-login';
export const inject = ['webServer', 'connection'];
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
export function resolveConfig(raw) {
  if (!Array.isArray(raw?.origins) || !raw.origins.length) throw new Error('origins required');
  const origins = raw.origins.map(value => {
    const url = new URL(value);
    if (url.origin !== value || !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback.has(url.hostname)))) throw new Error('origins must be canonical HTTPS or HTTP loopback origins');
    return url;
  });
  if (new Set(origins.map(url => url.host)).size !== origins.length) throw new Error('ambiguous origins sharing authority');
  if (typeof raw.frontendIndex !== 'string' || !isAbsolute(raw.frontendIndex)) throw new Error('absolute frontendIndex required');
  return { origins, frontendIndex: raw.frontendIndex, socket: socketPath(raw.home) };
}
export function singleHeader(req, key) {
  const value = req.headers[key];
  if (typeof value !== 'string') return undefined;
  if (req.rawHeaders) {
    let n = 0; for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === key) n++;
    if (n !== 1) return undefined;
  }
  return value;
}
function reply(res, status, value, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...headers });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (singleHeader(req, 'content-type') !== 'application/json') throw new Error('invalid-body');
  if (Number(req.headers['content-length'] || 0) > 1024) throw new Error('invalid-body');
  let text = '';
  let timer;
  try {
    return await Promise.race([(async () => {
      for await (const chunk of req) { text += chunk; if (text.length > 1024) throw new Error('invalid-body'); }
      const value = JSON.parse(text || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-body');
      return value;
    })(), new Promise((_, reject) => { timer = setTimeout(() => { reject(new Error('invalid-body')); req.destroy?.(); }, 5000); timer.unref?.(); })]);
  } finally { clearTimeout(timer); }
}
function metadata(value) { return String(value || '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 160); }
function cookieHeaders(headers, origin) {
  const cookie = headers['set-cookie'];
  if (typeof cookie === 'string' && origin.protocol === 'https:' && !/;\s*Secure(?:;|$)/i.test(cookie)) return { ...headers, 'set-cookie': cookie + '; Secure' };
  return headers;
}
export async function apply(ctx, raw) {
  const config = resolveConfig(raw);
  for (const origin of config.origins) if (ctx.connection.requestRejection({ headers: { host: origin.host, origin: origin.origin } }) !== 401) throw new Error('origin must be accepted by native trustedHosts');
  await readFile(config.frontendIndex, 'utf8');
  const state = new Requests();
  const stop = await startSocket(config.socket, state);
  const timer = setInterval(() => state.prune(), 30000); timer.unref();
  const disposers = [];
  let activeBodies = 0;
  const originOf = req => config.origins.find(origin => origin.host === singleHeader(req, 'host'));
  const pageHeaders = nonce => ({ 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8', 'referrer-policy': 'same-origin', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` });
  const index = async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) return reply(res, 405, { error: 'method-not-allowed' }, { allow: 'GET, HEAD' });
    const origin = originOf(req);
    if (!origin) return reply(res, 403, { error: 'untrusted-origin' });
    const rejection = ctx.connection.requestRejection({ headers: { host: origin.host, cookie: req.headers.cookie } });
    if (rejection === 403) return reply(res, 403, { error: 'untrusted-host' });
    if (new URL(req.url, origin).searchParams.has('token')) {
      if (!ctx.connection.authorizeIndex(req, { writeHead: (status, headers) => res.writeHead(status, cookieHeaders(headers, origin)), end: value => res.end(value) })) return;
    } else if (rejection !== undefined) {
      const nonce = randomBytes(16).toString('base64');
      res.writeHead(200, pageHeaders(nonce));
      const html = req.headers['sec-fetch-site'] === 'cross-site' ? '<!doctype html><meta http-equiv="refresh" content="0;url=/"><a href="/">继续打开 DSH</a>' : loginPage(nonce);
      res.end(req.method === 'HEAD' ? undefined : html); return;
    }
    const html = ctx.webServer.renderIndex(await readFile(config.frontendIndex, 'utf8')).replace(/<head(?:\s[^>]*)?>/i, head => head + '<base href="/">');
    res.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : html);
  };
  const api = action => async (req, res) => {
    if (req.method !== 'POST') return reply(res, 405, { error: 'method-not-allowed' }, { allow: 'POST' });
    const origin = originOf(req);
    if (!origin || singleHeader(req, 'origin') !== origin.origin || ctx.connection.requestRejection(req) === 403) return reply(res, 403, { error: 'untrusted-origin' });
    if (activeBodies >= 16) return reply(res, 429, { error: 'rate-limited' }, { 'retry-after': '2' });
    activeBodies++;
    try {
      const value = await body(req);
      if (action === 'create') return reply(res, 200, state.create(origin.origin, { peer: metadata(req.socket?.remoteAddress), userAgent: metadata(req.headers['user-agent']) }));
      const result = state.status(value.secret, origin.origin);
      if (result !== 'approved') return reply(res, 200, { state: result });
      const internal = new URL(ctx.connection.authenticatedUrl(origin.origin));
      let issued;
      const authorized = ctx.connection.authorizeIndex({ method: 'GET', url: internal.pathname + internal.search, headers: { host: origin.host } }, {
        writeHead(status, headers) {
          if (status !== 303 || headers.location !== '/' || typeof headers['set-cookie'] !== 'string') throw new Error('cookie-exchange-failed');
          issued = cookieHeaders(headers, origin)['set-cookie'];
        }, end() {},
      });
      if (authorized || !issued) throw new Error('cookie-exchange-failed');
      return reply(res, 200, { state: 'approved' }, { 'set-cookie': issued });
    } catch (e) {
      const status = e.message === 'rate-limited' ? 429 : e.message === 'unknown-request' ? 404 : e.message === 'cookie-exchange-failed' ? 500 : 400;
      reply(res, status, { error: status === 400 ? 'invalid-body' : e.message }, status === 429 ? { 'retry-after': '2' } : {});
    } finally { activeBodies--; }
  };
  try {
    for (const path of ['/', '/index.html', '/login']) disposers.push(ctx.webServer.register({ kind: 'exact', path, handler: index }));
    for (const action of ['create', 'status']) disposers.push(ctx.webServer.register({ kind: 'exact', path: '/auth/device-code/' + action, handler: api(action) }));
    ctx.effect(() => async () => { for (const dispose of disposers.reverse()) dispose(); clearInterval(timer); await stop(); }, 'device-code-login lifecycle');
  } catch (e) { for (const dispose of disposers.reverse()) dispose(); clearInterval(timer); await stop(); throw e; }
}
