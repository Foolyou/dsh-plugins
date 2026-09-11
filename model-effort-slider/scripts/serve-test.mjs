import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const result = await build({ entryPoints: ['tests/fixture.tsx'], bundle: true, write: false, jsx: 'automatic', alias: { react: require.resolve('react'), 'react/jsx-runtime': require.resolve('react/jsx-runtime') }, loader: { '.css': 'text' } });
createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(result.outputFiles[0].text); }
  else { res.setHeader('content-type','text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="app" style="position:absolute;bottom:25px;left:20px;font-family:Arial"></div><script src="/fixture.js"></script>'); }
}).listen(15082, '127.0.0.1', () => console.log('fixture-ready'));
