import { build } from 'esbuild';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
await mkdir('lib', { recursive: true });
const common = { bundle: true, write: false, target: 'es2022', legalComments: 'inline' };
const host = await build({ ...common, entryPoints: ['src/index.js'], format: 'esm', platform: 'node' });
const client = await build({ ...common, entryPoints: ['src/client.js'], format: 'cjs', platform: 'browser', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-store'], loader: { '.css': 'text' } });
for (const [name, content] of [
  ['index', host.outputFiles[0].text],
  ['client', `/* MIT © 2026 DeepSeek; independent mobile-sidebar-layout fork. See ../LICENSE. */\nwindow.__ModuleLoader__.load({id:"@deepseek-ai/dsh-client-ui-layout",factory:(require)=>{const module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`]
]) {
  await writeFile(`lib/${name}.js.tmp`, content); await rename(`lib/${name}.js.tmp`, `lib/${name}.js`);
}
console.log('Built independent mobile sidebar layout (compatible module ID)');
