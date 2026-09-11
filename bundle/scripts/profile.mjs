import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrate, BUNDLE_NAME } from './migrate.mjs';

const usage = `Usage: npm run bundle:profile -- --profile-dir /path/to/DSH_HOME/profiles/web [--apply]

Default: inspect only; show managed IDs, never print private configuration.
--apply: back up and atomically replace each profile file. Stop the existing DSH
service first: package.json and cordis.patch.yml cannot be replaced atomically
as a pair. Install/link dsh-plugins-bundle with 'dsh plugin' before applying.
This command does not install packages, restart services, or alter credentials.
`;
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(usage); return; }
  let profileDir;
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile-dir' && args[i + 1] && !args[i + 1].startsWith('--')) profileDir = resolve(args[++i]);
    else if (args[i] === '--apply') apply = true;
    else throw new Error(`Unknown or incomplete option ${args[i]}\n${usage}`);
  }
  if (!profileDir) throw new Error(usage);
  const manifestPath = join(profileDir, 'package.json');
  const patchPath = join(profileDir, 'cordis.patch.yml');
  const manifest = await readFile(manifestPath, 'utf8');
  let patch;
  try { patch = await readFile(patchPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; patch = '[]\n'; }
  const next = migrate(manifest, patch);
  console.log(`Profile: ${profileDir}`);
  console.log(`Bundle: ${BUNDLE_NAME}`);
  console.log(`Managed inserts to migrate: ${next.migrated.join(', ') || '(none)'}`);
  if (!next.changed) { console.log('Already configured; no files changed.'); return; }
  if (!apply) { console.log('Dry run only. Stop the service and rerun with --apply to write the migration.'); return; }
  const installed = JSON.parse(await readFile(join(profileDir, 'node_modules', BUNDLE_NAME, 'package.json'), 'utf8'));
  if (installed.name !== BUNDLE_NAME || !installed.dsh?.bundle) throw new Error('Install dsh-plugins-bundle into this profile first.');
  await access(join(profileDir, 'node_modules', BUNDLE_NAME, 'lib/mobile-sidebar-layout/lib/client.js'));
  // Concurrency check before backups/writes: refuse to overwrite intervening edits.
  if (await readFile(manifestPath, 'utf8') !== manifest) throw new Error('Profile manifest changed during migration; retry.');
  const currentPatch = await readFile(patchPath, 'utf8').catch(error => { if (error.code === 'ENOENT') return '[]\n'; throw error; });
  if (currentPatch !== patch) throw new Error('Profile patch changed during migration; retry.');
  const backup = join(profileDir, '.dsh-plugins-bundle-backups', randomUUID());
  await mkdir(backup, { recursive: true, mode: 0o700 });
  await writeFile(join(backup, 'package.json'), manifest, { mode: 0o600 });
  await writeFile(join(backup, 'cordis.patch.yml'), patch, { mode: 0o600 });
  const replace = async (path, text) => {
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, text, { mode: 0o600 });
    await rename(temp, path);
  };
  await replace(manifestPath, next.manifestText);
  await replace(patchPath, next.patchText);
  console.log(`Migration written. Private backup: ${backup}`);
  console.log('Validate with dsh --profile <name> --dump-config, then start the existing service and refresh its GUI.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
