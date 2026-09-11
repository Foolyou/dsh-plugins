import { build } from 'esbuild';
import { mkdir, writeFile, watch, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
async function compile() {
  // Host half: plain ESM for the Node loader (`main`), plus the browser bundle.
  const [host, client] = await Promise.all([
    build({ entryPoints: ['src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22' }),
    build({ entryPoints: ['src/client.tsx'], bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2022', jsx: 'automatic', external: ['react', 'react-dom', 'react/jsx-runtime'], loader: { '.css': 'text' } }),
  ]);
  await mkdir('lib', { recursive: true });
  await writeFile('lib/index.js.tmp', host.outputFiles[0].text);
  await rename('lib/index.js.tmp', 'lib/index.js');
  await writeFile('lib/client.js.tmp', `window.__ModuleLoader__.load({id:"dsh-model-effort-slider",factory:(require)=>{const module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`);
  await rename('lib/client.js.tmp', 'lib/client.js');
  console.log('Built model effort slider (host + client)');
}
await compile();
if (process.argv.includes('--watch')) {
  for await (const event of watch('src', { recursive: true })) {
    try { await compile(); } catch (error) { console.error(error); }
  }
}
