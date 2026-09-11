import { mkdir, readFile, writeFile, copyFile, rename } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, '../mobile-sidebar-layout');
const target = join(root, 'lib/mobile-sidebar-layout');
const original = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
// Preserve the official browser identity without shadowing the installed package.
// A package-local filesystem entry, not a bare-name alias, is required by DSH.
const manifest = Object.fromEntries(['name', 'version', 'private', 'type', 'main', 'exports', 'dsh', 'license'].map(key => [key, original[key]]));
const files = await Promise.all(['index.js', 'client.js'].map(name => readFile(join(source, 'lib', name))));
await mkdir(join(target, 'lib'), { recursive: true });
for (const [index, name] of ['index.js', 'client.js'].entries()) {
  const path = join(target, 'lib', name);
  await writeFile(`${path}.tmp`, files[index]);
  await rename(`${path}.tmp`, path);
}
await copyFile(join(source, 'LICENSE'), join(target, 'LICENSE'));
await writeFile(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Built DSH Bundle optional mobile layout (original identity and license preserved)');
