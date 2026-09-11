import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints:['src/index.ts'], outfile:'dist/index.js', bundle:true, format:'esm', platform:'browser', external:['react', 'react/jsx-runtime'], sourcemap:true });
await copyFile('src/node-slider.css', 'dist/node-slider.css');
await build({ entryPoints:['examples/demo.tsx'], outfile:'demo-dist/demo.js', bundle:true, format:'esm', sourcemap:true });
