import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/profile.mjs', import.meta.url));
const bundle = fileURLToPath(new URL('..', import.meta.url));
const original = JSON.stringify({ private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } });
const patch = '- insert: [{id: codex-auth, name: dsh-codex-auth}]\n';

test('profile CLI dry run is read-only; apply creates private backups and is idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bundle-migrate-'));
  try {
    await writeFile(join(root, 'package.json'), original);
    await writeFile(join(root, 'cordis.patch.yml'), patch);
    const run = (...args) => execFileSync(process.execPath, [script, '--profile-dir', root, ...args], { encoding: 'utf8' });
    assert.match(run(), /Dry run only/);
    assert.equal(await readFile(join(root, 'package.json'), 'utf8'), original);
    assert.equal(await readFile(join(root, 'cordis.patch.yml'), 'utf8'), patch);
    assert.deepEqual((await readdir(root)).sort(), ['cordis.patch.yml', 'package.json']);
    await mkdir(join(root, 'node_modules'));
    await symlink(bundle, join(root, 'node_modules', 'dsh-plugins-bundle'), 'dir');
    assert.match(run('--apply'), /Migration written/);
    const backupDir = join(root, '.dsh-plugins-bundle-backups');
    const [backup] = await readdir(backupDir);
    assert.equal(await readFile(join(backupDir, backup, 'package.json'), 'utf8'), original);
    assert.equal(await readFile(join(backupDir, backup, 'cordis.patch.yml'), 'utf8'), patch);
    if (process.platform !== 'win32') assert.equal((await stat(join(backupDir, backup, 'cordis.patch.yml'))).mode & 0o777, 0o600);
    assert.match(run('--apply'), /Already configured/);
    assert.equal((await readdir(backupDir)).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('profile CLI refuses unknown arguments and does not choose a real home implicitly', () => {
  assert.throws(() => execFileSync(process.execPath, [script], { stdio: 'pipe' }), /Usage/);
  assert.throws(() => execFileSync(process.execPath, [script, '--unknown'], { stdio: 'pipe' }), /Unknown/);
});
