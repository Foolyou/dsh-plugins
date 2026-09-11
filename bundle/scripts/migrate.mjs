import { parseDocument, isMap, isSeq } from 'yaml';

export const BUNDLE_NAME = 'dsh-plugins-bundle';
export const MANAGED = new Map([
  ['ui-model-effort-slider', 'dsh-model-effort-slider'],
  ['authorization', '@deepseek-ai/dsh-authorization'],
  ['codex-auth', 'dsh-codex-auth'],
  ['provider-balance', 'dsh-provider-balance'],
  ['ui-mobile-sidebar-layout', 'mobile-sidebar-layout'],
  ['device-code-login', 'dsh-device-code-login'],
]);
const optional = new Set(['ui-mobile-sidebar-layout', 'device-code-login']);
const jsTag = { tag: 'tag:yaml.org,2002:js', resolve: value => value };

function knownName(id, name) {
  if (typeof name !== 'string') return false;
  if (name === MANAGED.get(id)) return true;
  if (id === 'ui-mobile-sidebar-layout') return /(?:^|\/)mobile-sidebar-layout\/lib\/index\.js$/.test(name);
  if (id === 'device-code-login') return /(?:^|\/)device-code-login\/src\/index\.js$/.test(name);
  return false;
}
function assertKnown(row, id) {
  if (!knownName(id, row.get('name'))) throw new Error(`Refusing to replace customized entry ${id}: its plugin name is not recognized.`);
}
function rejectNested(entries) {
  for (const row of entries.items) {
    if (!isMap(row)) continue;
    if (MANAGED.has(row.get('id'))) throw new Error(`Cannot automatically migrate nested entry ${row.get('id')}; move it to the root first.`);
    if (row.get('group') && isSeq(row.get('config'))) rejectNested(row.get('config'));
  }
}

/** Pure migration: retain unknown patches, tagged expressions and whole configs. */
export function migrate(manifestText, patchText) {
  const manifest = JSON.parse(manifestText);
  if (!manifest.dsh?.profile || !Array.isArray(manifest.dsh.profile.bundles)) throw new Error('Expected an existing DSH profile with dsh.profile.bundles.');
  const bundles = manifest.dsh.profile.bundles;
  if (!bundles.includes('@deepseek-ai/dsh-base') || !bundles.includes('@deepseek-ai/dsh-web-app')) throw new Error('This bundle requires the official dsh-base and dsh-web-app layers.');
  if (bundles.filter(name => name === BUNDLE_NAME).length > 1) throw new Error('Duplicate bundle entries in this profile.');
  const doc = parseDocument(patchText, { customTags: [jsTag] });
  if (doc.errors.length) throw new Error(`Invalid profile patch: ${doc.errors[0].message}`);
  let patchChanged = !doc.contents;
  if (!doc.contents) doc.contents = doc.createNode([]);
  if (!isSeq(doc.contents)) throw new Error('Expected a top-level YAML patch array.');
  const result = [];
  const migrated = [];
  for (const patch of doc.contents.items) {
    if (!isMap(patch)) throw new Error('Expected each patch to be a YAML mapping.');
    const inserts = patch.get('insert');
    const overrides = [];
    if (isSeq(inserts)) {
      const keep = [];
      for (const entry of inserts.items) {
        if (!isMap(entry)) throw new Error('Expected each inserted entry to be a YAML mapping.');
        if (entry.get('group') && isSeq(entry.get('config'))) rejectNested(entry.get('config'));
        const id = entry.get('id');
        if (!MANAGED.has(id)) { keep.push(entry); continue; }
        if (patch.has('id')) throw new Error(`Cannot automatically migrate nested entry ${id}; its insert targets a parent entry.`);
        assertKnown(entry, id);
        if (migrated.includes(id)) throw new Error(`Duplicate inserted entry ${id}; resolve it before migrating.`);
        migrated.push(id);
        const override = entry.clone();
        override.delete('name');
        // Preserve the enabled state of an already installed opt-in feature.
        if (optional.has(id) && !override.has('disabled')) override.set('disabled', false);
        if (override.items.length > 1) overrides.push(override);
        patchChanged = true;
      }
      inserts.items = keep;
      if (!keep.length) patch.delete('insert');
    }
    const id = patch.get('id');
    if (MANAGED.has(id) && patch.has('name')) {
      assertKnown(patch, id);
      // Existing name assertions may be absolute paths; Bundle owns the source now.
      patch.delete('name');
      patchChanged = true;
    }
    if (patch.items.length) result.push(patch);
    result.push(...overrides);
  }
  doc.contents.items = result;
  if (!result.length) doc.contents.flow = true;
  if (!bundles.includes(BUNDLE_NAME)) bundles.push(BUNDLE_NAME);
  const nextManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  return {
    manifestText: JSON.stringify(JSON.parse(manifestText)) === JSON.stringify(manifest) ? manifestText : nextManifest,
    patchText: patchChanged ? String(doc) : patchText,
    migrated,
    changed: JSON.stringify(JSON.parse(manifestText)) !== JSON.stringify(manifest) || patchChanged,
  };
}
