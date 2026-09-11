import { build } from 'esbuild';
import { createServer } from 'node:http';
import { AuthController } from '../src/controller.ts';
import { handler } from '../src/http.ts';
import { mockServices } from '../tests/mock.ts';
const result = await build({ entryPoints: ['tests/fixture.tsx'], bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'text' } });
let mock = mockServices(); let controller = new AuthController(mock.services); let fetch = handler(controller);
const server = createServer(async (req, res) => {
  if (req.url === '/api/dsh-codex-auth') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const request = new Request('http://127.0.0.1:15083' + req.url, { method: req.method, headers: req.headers as Record<string, string>, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
    const response = await fetch(request); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } else if (req.url === '/test/reset' && req.method === 'POST') {
    await controller.dispose(); mock = mockServices(); controller = new AuthController(mock.services); fetch = handler(controller); res.end('ok');
  } else if (req.url === '/test/complete' && req.method === 'POST') { mock.complete(); res.end('ok');
  } else if (req.url === '/test/fail' && req.method === 'POST') { mock.fail(); res.end('ok');
  } else if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(result.outputFiles[0].text);
  } else { res.setHeader('content-type','text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="app" style="font-family:Arial"></div><script src="/fixture.js"></script>'); }
});
server.listen(15083, '127.0.0.1', () => console.log('fixture-ready'));
