import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const bundle = (entry, options) => build({ entryPoints: [entry], bundle: true, write: false, ...options }).then(result => result.outputFiles[0].text);
const [fixture, host, html, css] = await Promise.all([
  bundle('tests/fixture.tsx', { jsx: 'automatic', alias: { react: require.resolve('react'), 'react/jsx-runtime': require.resolve('react/jsx-runtime') }, loader: { '.css': 'text' } }),
  bundle('tests/fixture-host.ts', { format: 'esm', platform: 'node', target: 'node22' }),
  readFile(join(root, 'tests', 'fixture.html'), 'utf8'),
  readFile(join(root, 'tests', 'fixture.css'), 'utf8'),
]);
// Importing the bundle runs the real host entry, which registers the real route.
const { route, toRequest } = await import(`data:text/javascript,${encodeURIComponent(host)}`);
const api = route();
if (!api) throw new Error('fixture host did not register its route');
// Match the real Connection registry: exact pathname AND registered method.
const owns = (pathname, method) => pathname === api.path && api.methods.includes(method);

createServer(async (req, res) => {
  try {
    if (req.url === '/fixture.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(fixture); return; }
    if (req.url === '/fixture.css') { res.writeHead(200, { 'content-type': 'text/css' }); res.end(css); return; }
    if (owns(new URL(req.url ?? '/', 'http://127.0.0.1:15082').pathname, req.method ?? 'GET')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await api.fetch(toRequest({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) }, 'http://127.0.0.1:15082'));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`fixture failure: ${error instanceof Error ? error.stack : String(error)}`);
  }
}).listen(15082, '127.0.0.1', () => console.log('fixture-ready'));
