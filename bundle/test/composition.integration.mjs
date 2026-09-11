import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// These tests use the installed host, not workspace substitutes or a live GUI.
// They prove composition, host imports and client discovery/bytes, NOT service
// activation or browser execution. In particular no Web server is installed.
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const bundleDir = join(workspace, 'bundle');
const bundleName = 'dsh-plugins-bundle';
const layoutName = '@deepseek-ai/dsh-client-ui-layout';
const browserNames = ['dsh-model-effort-slider', 'dsh-codex-auth', 'dsh-provider-balance'];
const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', bundleName];
const managedIds = ['ui-model-effort-slider', 'authorization', 'codex-auth', 'provider-balance', 'ui-mobile-sidebar-layout', 'device-code-login'];
const relevantIds = new Set([...managedIds, 'ui-layout']);
const mobilePatch = [
  { id: 'ui-layout', disabled: true },
  { id: 'ui-mobile-sidebar-layout', disabled: false },
];

async function installedHost() {
  let installDir = process.env.DSH_INSTALL_DIR;
  if (!installDir) {
    try {
      // npm_execpath also works with nvm and npm installations absent from PATH.
      const npmScript = process.env.npm_execpath;
      const root = npmScript
        ? execFileSync(process.execPath, [npmScript, 'root', '-g'], { encoding: 'utf8', timeout: 30_000 }).trim()
        : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', timeout: 30_000 }).trim();
      installDir = join(root, '@deepseek-ai', 'dsh');
    } catch (cause) {
      throw new Error('Cannot locate installed DSH using npm root -g; set DSH_INSTALL_DIR to its package directory.', { cause });
    }
  }
  const installAnchor = join(resolve(installDir), 'package.json');
  const manifest = JSON.parse(await readFile(installAnchor, 'utf8'));
  assert.equal(manifest.name, '@deepseek-ai/dsh', 'DSH_INSTALL_DIR must point to the installed DSH package');
  const require = createRequire(installAnchor);
  const load = name => import(pathToFileURL(require.resolve(name)).href);
  const [boot, cordis, loader, clients] = await Promise.all([
    load('@deepseek-ai/dsh-app-boot'), load('@deepseek-ai/cordis'),
    load('@deepseek-ai/cordis-plugin-loader'), load('@deepseek-ai/dsh-client-modules'),
  ]);
  for (const name of ['loadProfileDirectory', 'composeEntries', 'healProfilesModuleFallback', 'mountRootInclude', 'assertEntriesLoaded']) {
    assert.equal(typeof boot[name], 'function', `Installed DSH must support ${name}`);
  }
  return { ...boot, Context: cordis.Context, Loader: loader.default, ClientModuleRegistry: clients.ClientModuleRegistry, installAnchor, version: manifest.version };
}

function allRows(rows) {
  return rows.flatMap(row => [row, ...(row.group && Array.isArray(row.config) ? allRows(row.config) : [])]);
}

function composed(host, profile, user = profile.patches) {
  const warnings = [];
  const rows = host.composeEntries([...profile.layers.map(layer => layer.patches), user], warning => warnings.push(warning));
  assert.deepEqual(warnings, [], 'all bundle/user patch targets must resolve without warnings');
  return rows;
}

function assertStableIds(rows) {
  const ids = allRows(rows).map(row => row.id);
  assert.equal(new Set(ids).size, ids.length, 'composed tree must not contain duplicate entry IDs');
  for (const id of relevantIds) assert.equal(ids.filter(value => value === id).length, 1, `${id} stays present exactly once, even when disabled`);
}

async function fixture(t, host, patches = [], { relocated = false } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-bundle-integration-'));
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const contexts = [];
  t.after(async () => {
    try {
      for (const ctx of contexts.reverse()) await ctx.fiber.dispose();
    } finally {
      if (oldHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = oldHome;
      await rm(home, { recursive: true, force: true });
    }
  });
  let target = bundleDir;
  if (relocated) {
    target = join(home, 'relocated', 'bundle');
    await mkdir(target, { recursive: true });
    // Copy only the installable payload; dependency resolution is intentionally
    // provided separately, just as installing the copied bundle would provide it.
    for (const name of ['package.json', 'cordis.patch.yml', 'lib']) {
      await cp(join(bundleDir, name), join(target, name), { recursive: true });
    }
    await symlink(join(workspace, 'node_modules'), join(dirname(target), 'node_modules'), 'dir');
  }
  const dir = join(home, 'profiles', 'bundle-integration');
  await mkdir(join(dir, 'node_modules'), { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: 'bundle-integration', private: true, type: 'module',
    dsh: { profile: { bundles, patchReload: 'startup' } },
  }));
  // JSON is valid YAML; no alternative patch/composition implementation is used.
  await writeFile(join(dir, 'cordis.patch.yml'), JSON.stringify(patches));
  await symlink(target, join(dir, 'node_modules', bundleName), 'dir');
  assert.deepEqual(await readdir(join(dir, 'node_modules')), [bundleName], 'only the bundle is prelinked, never leaf plugins');
  const profile = host.loadProfileDirectory('bundle-integration', dir, host.installAnchor);
  assert.deepEqual(profile.layers.map(layer => layer.packageName), bundles);
  assert.equal(await realpath(profile.layers[2].packageDir), await realpath(target));
  await host.healProfilesModuleFallback({ installAnchor: host.installAnchor, profile, home });
  for (const name of [...browserNames, 'dsh-device-code-login', 'node-slider']) {
    const projected = join(dir, 'node_modules', name);
    assert.ok((await lstat(projected)).isSymbolicLink(), `${name} must be projected by official dependency-closure healing`);
    assert.equal(await realpath(projected), await realpath(join(workspace, 'node_modules', name)));
  }
  // Healing twice must leave the same resolvable projection, without altering
  // the user-owned bundle symlink.
  await host.healProfilesModuleFallback({ installAnchor: host.installAnchor, profile, home });
  assert.equal(await realpath(join(dir, 'node_modules', bundleName)), await realpath(target));
  const rows = composed(host, profile);
  assertStableIds(rows);
  assert.deepEqual(composed(host, profile), rows, 'recomposition is deterministic');
  return { home, dir, target, profile, rows, contexts };
}

async function loadRelevant(t, host, fixture) {
  const rows = allRows(fixture.rows).filter(row => relevantIds.has(row.id));
  assert.equal(rows.length, relevantIds.size);
  const configPath = join(fixture.dir, 'integration.cordis.json');
  await writeFile(configPath, JSON.stringify(rows));
  const ctx = new host.Context();
  fixture.contexts.push(ctx);
  ctx.baseUrl = pathToFileURL(`${fixture.dir}/`).href;
  await ctx.plugin(host.Loader);
  // Do NOT pass an installation bareModuleBaseUrl: plugin resolution must use
  // the actual profile and the official fallback links healed above.
  await host.mountRootInclude(ctx, configPath);
  await ctx.loader.await();
  host.assertEntriesLoaded(ctx, 'bundle-integration');
  const entries = [...ctx.loader.entries()].filter(entry => relevantIds.has(entry.options.id));
  assert.equal(entries.length, rows.length, 'Loader sees every selected row');
  for (const entry of entries) {
    const row = rows.find(row => row.id === entry.options.id);
    assert.equal(Boolean(entry.disabled), Boolean(row.disabled));
    if (!row.disabled) assert.ok(entry.fiber, `${row.id} imports successfully`);
    else assert.equal(entry.fiber, undefined, `${row.id} remains unloaded`);
  }
  assert.equal(ctx.get('webServer'), undefined, 'no server/listener service is mounted');
  t.diagnostic(`Installed DSH ${host.version}: import proof only; service activation is deliberately not asserted.`);
  return ctx;
}

// The official registry serves a one-module combo: executable client bytes,
// separator and a new source-map directive. Compare every executable byte,
// normalizing only the bundler debug trailers that this transport replaces.
function executableSource(text) {
  return text.replace(/(?:\r?\n)?\/\/[#@] sourceURL=[^\r\n]*(?:\r?\n)?$/, '')
    .replace(/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/, '')
    .replace(/\n?$/, '\n');
}

async function discover(t, host, ctx, expectedNames) {
  const registry = new host.ClientModuleRegistry(ctx);
  const graph = registry.graph();
  const names = graph.entries.map(entry => entry.id);
  assert.deepEqual([...names].sort(), [...expectedNames].sort());
  assert.equal(new Set(names).size, names.length, 'no duplicate browser module IDs');
  assert.equal(names.filter(name => name === layoutName).length, 1, 'exactly one official-identity layout is advertised');
  assert.equal(ctx.get('webServer'), undefined);
  for (const entry of graph.entries) {
    const path = registry.clientPath(entry.id);
    assert.ok(path, `${entry.id} has a discoverable client path`);
    const response = registry.fetchBundle(new Request(new URL(entry.url, 'http://dsh.invalid')));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    const body = await response.text();
    const executable = executableSource(await readFile(path, 'utf8'));
    assert.ok(body.startsWith(`${executable};\n`), `${entry.id}: served executable bytes equal discovered file bytes`);
    assert.match(body.slice(executable.length + 2), /^\/\/# sourceMappingURL=.+\n$/);
    const head = registry.fetchBundle(new Request(new URL(entry.url, 'http://dsh.invalid'), { method: 'HEAD' }));
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }
  assert.equal(registry.fetchBundle(new Request('http://dsh.invalid/plugins/not-advertised.js')).status, 404);
  t.diagnostic('ClientModuleRegistry graph/clientPath/fetchBundle exercised in-process; no HTTP listener or browser was started.');
  return registry;
}

// Keep tests sequential: each fixture scopes DSH_HOME and restores it on exit.
test('installed DSH bundle composition and no-listener client discovery', { timeout: 120_000 }, async t => {
  const host = await installedHost();
  await t.test('defaults, dependency closure, stable IDs and successful host imports', async t => {
    const f = await fixture(t, host);
    const byId = new Map(allRows(f.rows).map(row => [row.id, row]));
    for (const id of ['ui-model-effort-slider', 'authorization', 'codex-auth', 'provider-balance', 'ui-layout']) {
      assert.notEqual(byId.get(id).disabled, true, `${id} defaults enabled`);
    }
    for (const id of ['ui-mobile-sidebar-layout', 'device-code-login']) assert.equal(byId.get(id).disabled, true);
    assert.equal(byId.get('ui-mobile-sidebar-layout').name, new URL('./lib/mobile-sidebar-layout/lib/index.js', pathToFileURL(f.profile.layers[2].patchPath)).href);
    assert.equal(await realpath(fileURLToPath(byId.get('ui-mobile-sidebar-layout').name)), await realpath(join(f.target, 'lib/mobile-sidebar-layout/lib/index.js')));
    assert.equal(allRows(f.rows).some(row => row.name === 'node-slider'), false, 'library dependency is not a Loader row');
    const ctx = await loadRelevant(t, host, f);
    const registry = await discover(t, host, ctx, [...browserNames, layoutName]);
    assert.notEqual(await realpath(registry.clientPath(layoutName)), await realpath(join(bundleDir, 'lib/mobile-sidebar-layout/lib/client.js')));
  });

  for (const [id, name] of [['ui-model-effort-slider', browserNames[0]], ['codex-auth', browserNames[1]], ['provider-balance', browserNames[2]]]) {
    await t.test(`user disables ${id}: retained row, absent browser module, whole-config override`, async t => {
      const patches = [
        { id: 'provider-balance', config: { obsolete: true, cacheTtlMs: 123 } },
        { id: 'provider-balance', name: 'dsh-provider-balance', config: { cacheTtlMs: 456 } },
        { id, name, disabled: true },
      ];
      const f = await fixture(t, host, patches);
      assert.deepEqual(allRows(f.rows).find(row => row.id === 'provider-balance').config, { cacheTtlMs: 456 }, 'config replaces the whole object rather than deep-merging');
      assert.equal(allRows(f.rows).find(row => row.id === id).name, name, 'name is an assertion, not a rename');
      const ctx = await loadRelevant(t, host, f);
      const registry = await discover(t, host, ctx, [...browserNames.filter(value => value !== name), layoutName]);
      assert.equal(registry.clientPath(name), undefined, 'disabled plugin has no discoverable client artifact');
    });
  }

  await t.test('enabling both layout sources is rejected instead of silently aliasing the mobile fork', async t => {
    const f = await fixture(t, host, [{ id: 'ui-mobile-sidebar-layout', disabled: false }]);
    const ctx = await loadRelevant(t, host, f);
    assert.throws(() => new host.ClientModuleRegistry(ctx), /multiple active Loader sources/, 'official registry rejects duplicate layout package identity');
  });

  for (const relocated of [false, true]) {
    await t.test(`optional mobile layout${relocated ? ' after copying the bundle elsewhere' : ''}`, async t => {
      const f = await fixture(t, host, mobilePatch, { relocated });
      const byId = new Map(allRows(f.rows).map(row => [row.id, row]));
      assert.equal(byId.get('ui-layout').disabled, true);
      assert.equal(byId.get('ui-mobile-sidebar-layout').disabled, false);
      assert.equal(byId.get('device-code-login').disabled, true, 'enabling mobile does not enable authentication');
      const mobileRoot = join(f.target, 'lib/mobile-sidebar-layout');
      assert.equal(byId.get('ui-mobile-sidebar-layout').name, new URL('./lib/mobile-sidebar-layout/lib/index.js', pathToFileURL(f.profile.layers[2].patchPath)).href, 'relative entry is a file URL anchored beside the bundle patch');
      assert.equal(await realpath(fileURLToPath(byId.get('ui-mobile-sidebar-layout').name)), await realpath(join(mobileRoot, 'lib/index.js')), 'relative entry resolves to the relocated copy, not the source repository');
      assert.equal(JSON.parse(await readFile(join(mobileRoot, 'package.json'), 'utf8')).name, layoutName);
      const ctx = await loadRelevant(t, host, f);
      const registry = await discover(t, host, ctx, [...browserNames, layoutName]);
      assert.equal(await realpath(registry.clientPath(layoutName)), await realpath(join(mobileRoot, 'lib/client.js')), 'the only layout browser module is the copied mobile artifact');
      assert.deepEqual(await readFile(registry.clientPath(layoutName)), await readFile(join(workspace, 'mobile-sidebar-layout/lib/client.js')));
      const originalManifest = JSON.parse(await readFile(join(workspace, 'mobile-sidebar-layout/package.json'), 'utf8'));
      const copiedManifest = JSON.parse(await readFile(join(mobileRoot, 'package.json'), 'utf8'));
      // Build-only scripts/devDependencies are deliberately omitted; all original
      // runtime identity, entry/export and DSH metadata must remain unchanged.
      for (const field of ['name', 'version', 'private', 'type', 'main', 'exports', 'dsh', 'license']) {
        assert.deepEqual(copiedManifest[field], originalManifest[field], `mobile manifest preserves ${field}`);
      }
      assert.deepEqual(await readFile(join(mobileRoot, 'lib/index.js')), await readFile(join(workspace, 'mobile-sidebar-layout/lib/index.js')));
      assert.deepEqual(await readFile(join(mobileRoot, 'LICENSE')), await readFile(join(workspace, 'mobile-sidebar-layout/LICENSE')));
    });
  }
});
