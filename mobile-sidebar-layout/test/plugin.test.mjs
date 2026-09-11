import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
test('built module keeps identity, registers original contracts and retracts its effects', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const requested = [], cleanups = [], nodes = new Set(), tokens = new Map();
  let module, registration, service, providedHooks, mainListener, themeListener;
  const disposed = new Set();
  const document = {
    createElement(tag) { return { tag, dataset: {}, isConnected: false, remove() { nodes.delete(this); this.isConnected = false; } }; },
    head: { append(node) { nodes.add(node); node.isConnected = true; } },
    documentElement: { style: { set colorScheme(value) {}, removeProperty() {} } },
    body: { setAttribute() {}, removeAttribute() {}, style: { setProperty: (k,v) => tokens.set(k,v), removeProperty: k => tokens.delete(k) } }
  };
  const storeModule = { defineStore(spec) {
    const state = spec.init();
    const instance = { actions: Object.fromEntries(Object.entries(spec.actions).map(([k,fn]) => [k, (...args) => fn(state,...args)])),
      getSnapshot: () => state, subscribe: () => () => {} };
    return { create: () => instance };
  } };
  vm.runInNewContext(source, {
    window: { innerWidth: 390, __ModuleLoader__: { load(definition) {
      assert.equal(definition.id, '@deepseek-ai/dsh-client-ui-layout');
      module = definition.factory(name => { requested.push(name); return name === '@deepseek-ai/dsh-client-store' ? storeModule : require(name); });
    } } }, document, getComputedStyle: () => ({backgroundColor:'#fff'}), AbortController
  });
  assert.deepEqual([...new Set(requested)].sort(), ['@deepseek-ai/dsh-client-store','react','react/jsx-runtime']);
  assert.deepEqual(Array.from(module.inject), ['slots','theme','locale']);
  module.apply({
    effect(fn) { cleanups.push(fn()); },
    reflect: { provide(name, value) { assert.equal(name,'layout'); service = value; return () => disposed.add('service'); } },
    slots: {
      entries: () => [{options:{key:'example'}}],
      provideRoot(value) { providedHooks = value; return () => disposed.add('hooks'); },
      register(value, component) { registration = value; assert.equal(component.name,'AppFrame'); return () => disposed.add('registration'); },
      subscribe(name, listener) { assert.equal(name,'main'); mainListener = listener; return () => disposed.add('panels'); }
    },
    theme: { getTheme: () => ({active:{colorScheme:'light',tokens:{'--test':'red'}},fontSize:16}) },
    on(name, listener) { assert.equal(name,'theme/change'); themeListener = listener; return () => disposed.add('theme'); }
  });
  assert.equal(registration.name,'root'); assert.equal(registration.locale,'common');
  assert.deepEqual(Object.keys(registration.children).sort(), ['main','rightbar','shell.overlay','sidebar']);
  for (const [key, kind] of Object.entries({ main:'keyed',rightbar:'single','shell.overlay':'list',sidebar:'single' })) {
    assert.equal(registration.children[key].kind,kind); assert.equal(registration.children[key].scope,'root');
  }
  assert.ok(service instanceof module.LayoutController);
  service.selectPanel('example'); assert.equal(providedHooks.hooks.panelInfo.getSnapshot().activePanelId,'example');
  assert.throws(() => service.selectPanel('bad'), /not registered/);
  mainListener();
  assert.equal(registration.store.create(),registration.store.create());
  assert.equal(nodes.size,2); assert.equal(tokens.get('--test'),'red');
  themeListener({active:{colorScheme:'dark',tokens:{}},fontSize:18});
  assert.equal(tokens.has('--test'),false); assert.equal(tokens.get('--dsh-content-font-size'),'18px');
  const navigation = service.beginNavigation();
  for (const cleanup of cleanups.reverse()) cleanup();
  assert.equal(navigation.aborted,true); assert.equal(nodes.size,0); assert.equal(tokens.size,0);
  assert.deepEqual([...disposed].sort(),['hooks','panels','registration','service','theme']);
});
