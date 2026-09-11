import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { migrate, BUNDLE_NAME } from '../scripts/migrate.mjs';

const manifest = JSON.stringify({ name: 'custom-profile', private: true, dependencies: { other: '^1' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patchReload: 'live' } } });
const js = [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }];
const decode = text => parse(text, { customTags: js });

test('bundle owns the loading list, libraries remain dependencies, optional features start disabled', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const rows = parse(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))[0].insert;
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.main, undefined, 'a composition bundle needs no runtime aggregator');
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.equal(rows.find(row => row.id === 'device-code-login').disabled, true);
  assert.equal(rows.find(row => row.id === 'ui-mobile-sidebar-layout').disabled, true);
  assert.equal(rows.some(row => row.name === 'node-slider'), false);
  for (const row of rows.filter(row => row.name.startsWith('dsh-'))) assert.ok(pkg.dependencies[row.name]);
});

test('new profile adds one bundle and does not silently enable optional features', () => {
  const next = migrate(manifest, '[]\n');
  const value = JSON.parse(next.manifestText);
  assert.deepEqual(value.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', BUNDLE_NAME]);
  assert.deepEqual(value.dependencies, { other: '^1' });
  assert.equal(value.dsh.profile.patchReload, 'live');
  assert.equal(next.patchText, '[]\n');
  assert.equal(migrate(next.manifestText, next.patchText).changed, false);
});

test('migrates known inserts, preserves private tagged config and unrelated plugins', () => {
  const before = `# user settings\n- insert:\n    - id: ui-model-effort-slider\n      name: dsh-model-effort-slider\n    - id: custom\n      name: custom-plugin\n      config:\n        token: keep-private\n- id: connection\n  config:\n    trustedHosts: !!js ctx.webRuntime.trustedHosts\n    cookieMaxAgeDays: 30\n- insert:\n    - id: device-code-login\n      name: /source/device-code-login/src/index.js\n      config:\n        origins: [https://example.net]\n        frontendIndex: /runtime/index.html\n- id: ui-layout\n  disabled: true\n- insert:\n    - id: ui-mobile-sidebar-layout\n      name: /source/mobile-sidebar-layout/lib/index.js\n`;
  const next = migrate(manifest, before);
  const patches = decode(next.patchText);
  assert.deepEqual(next.migrated, ['ui-model-effort-slider', 'device-code-login', 'ui-mobile-sidebar-layout']);
  assert.deepEqual(patches[0].insert, [{ id: 'custom', name: 'custom-plugin', config: { token: 'keep-private' } }]);
  assert.match(next.patchText, /!!js ctx.webRuntime.trustedHosts/);
  assert.deepEqual(patches.find(row => row.id === 'device-code-login'), { id: 'device-code-login', disabled: false, config: { origins: ['https://example.net'], frontendIndex: '/runtime/index.html' } });
  assert.deepEqual(patches.find(row => row.id === 'ui-mobile-sidebar-layout'), { id: 'ui-mobile-sidebar-layout', disabled: false });
  assert.deepEqual(patches.find(row => row.id === 'ui-layout'), { id: 'ui-layout', disabled: true });
  assert.equal(migrate(next.manifestText, next.patchText).changed, false);
});

test('preserves disabled choices and later whole-config overrides in order', () => {
  const next = migrate(manifest, `- insert:\n    - id: codex-auth\n      name: dsh-codex-auth\n      disabled: true\n      config: {first: 1}\n- id: codex-auth\n  name: dsh-codex-auth\n  config: {second: 2}\n`);
  assert.deepEqual(decode(next.patchText), [{ id: 'codex-auth', disabled: true, config: { first: 1 } }, { id: 'codex-auth', config: { second: 2 } }]);
});

test('normalizes empty and comments-only user layers to an actual empty patch list', () => {
  for (const text of ['', '# my overrides\n']) {
    const next = migrate(manifest, text);
    assert.deepEqual(decode(next.patchText), []);
    assert.equal(migrate(next.manifestText, next.patchText).changed, false);
  }
});

test('refuses unexpected names, duplicate inserts and nested managed entries', () => {
  assert.throws(() => migrate(manifest, '- insert: [{id: codex-auth, name: someone-elses-plugin}]'), /customized entry/);
  assert.throws(() => migrate(manifest, '- insert: [{id: codex-auth, name: dsh-codex-auth}, {id: codex-auth, name: dsh-codex-auth}]'), /Duplicate inserted/);
  assert.throws(() => migrate(manifest, '- insert: [{id: group, group: true, config: [{id: codex-auth, name: dsh-codex-auth}]}]'), /nested entry/);
  assert.throws(() => migrate(manifest, '- id: group\n  insert: [{id: codex-auth, name: dsh-codex-auth}]'), /nested entry/);
  assert.throws(() => migrate('{}', '[]'), /existing DSH profile/);
  assert.throws(() => migrate(manifest, 'not: a-list'), /top-level YAML/);
});
