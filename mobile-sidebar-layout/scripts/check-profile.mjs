// Read-only validator: never start a second Host or normalize/rewrite a Profile.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const [profileArg, installArg] = process.argv.slice(2);
if (!profileArg || !installArg) {
  console.error('Usage: node scripts/check-profile.mjs <profile-directory> <installed-dsh-directory>');
  process.exit(2);
}
const profileDir = resolve(profileArg);
const installDir = resolve(installArg);
const { loadProfileDirectory, composeEntries, loadOptionalPatches } = await import(pathToFileURL(join(installDir, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')));
const profile = loadProfileDirectory('dsh', profileDir, join(installDir, 'package.json'));
const homeDir = process.env.DSH_HOME || dirname(dirname(profileDir));
const warnings = [];
const entries = composeEntries([
  ...profile.layers.map(layer => layer.patches),
  profile.patches,
  loadOptionalPatches('dsh', join(homeDir, 'cordis.patch.yml')) ?? [],
], warning => warnings.push(warning));
function flatten(rows) {
  return rows.flatMap(row => [row, ...(row.group && Array.isArray(row.config) ? flatten(row.config) : [])]);
}
const rows = flatten(entries);
assert.equal(warnings.length, 0, warnings.join('\n'));
const originals = rows.filter(row => row.id === 'ui-layout');
assert.equal(originals.length, 1, 'Expected exactly one original ui-layout row');
assert.equal(originals[0].disabled, true, 'Original layout must be disabled');
const replacements = rows.filter(row => row.id === 'ui-mobile-sidebar-layout');
assert.equal(replacements.length, 1, 'Expected exactly one replacement row');
assert.notEqual(replacements[0].disabled, true, 'Replacement must be enabled');
const expectedEntry = fileURLToPath(new URL('../lib/index.js', import.meta.url));
// Profile normalization converts absolute module paths into file URLs.
const replacementPath = replacements[0].name.startsWith('file:') ? fileURLToPath(replacements[0].name) : replacements[0].name;
assert.equal(replacementPath, expectedEntry, 'Use the absolute file entry, not a mismatched bare package alias');
const require = createRequire(join(profileDir, 'package.json'));
const entry = require.resolve(replacementPath);
const manifest = JSON.parse(readFileSync(join(dirname(dirname(entry)), 'package.json'), 'utf8'));
assert.equal(manifest.name, '@deepseek-ai/dsh-client-ui-layout', 'Compatibility module identity changed');
assert.equal(manifest.dsh.client.platform, 'web');
const bundle = readFileSync(join(dirname(entry), 'client.js'), 'utf8');
assert.ok(bundle.includes('@deepseek-ai/dsh-client-ui-layout'), 'Missing browser compatibility ID');
console.log(JSON.stringify({ profile: profileDir, originalDisabled: true, replacement: replacements[0].name, entry, moduleId: manifest.name, warnings }, null, 2));
console.log('PASS: composition and local bundle validated. This does not prove Client activation.');
