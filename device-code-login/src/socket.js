import net from 'node:net';
import { mkdir, lstat, chmod, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
export function socketPath(home = process.env.DSH_HOME || join(homedir(), '.dsh')) { return join(resolve(home), 'device-code-login', 'approval.sock'); }
async function stat(path) { try { return await lstat(path); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
export async function checkDirectory(path, create = false) {
  const directory = resolve(path, '..');
  if (create) await mkdir(directory, { mode: 0o700, recursive: true });
  const s = await lstat(directory);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o077)) throw new Error('unsafe socket directory: requires owner-only 0700 directory');
}
export async function callSocket(path, command) {
  await checkDirectory(path);
  const s = await lstat(path);
  if (!s.isSocket() || s.uid !== process.getuid() || (s.mode & 0o077)) throw new Error('unsafe approval socket');
  return new Promise((resolve, reject) => {
    const client = net.createConnection(path); let data = '';
    client.setTimeout(5000, () => client.destroy(new Error('approval socket timeout')));
    client.on('connect', () => client.write(JSON.stringify(command) + '\n'));
    client.on('error', reject);
    client.on('data', chunk => { data += chunk; if (data.length > 131072) client.destroy(new Error('oversized socket reply')); });
    client.on('end', () => { try { const result = JSON.parse(data); if (!result.ok) throw new Error(result.error); resolve(result.value); } catch (e) { reject(e); } });
  });
}
export async function startSocket(path, state) {
  await checkDirectory(path, true);
  const previous = await stat(path);
  if (previous) {
    if (!previous.isSocket() || previous.uid !== process.getuid()) throw new Error('refusing to remove non-socket or foreign path');
    const live = await new Promise((resolve, reject) => {
      const probe = net.createConnection(path);
      probe.setTimeout(1000, () => { probe.destroy(); reject(new Error('socket probe timed out; refusing removal')); });
      probe.on('connect', () => { probe.destroy(); resolve(true); });
      probe.on('error', e => { if (e.code === 'ECONNREFUSED') resolve(false); else reject(e); });
    });
    if (live) throw new Error('device-code-login approval socket already active');
    const current = await stat(path);
    if (!current || current.ino !== previous.ino || current.dev !== previous.dev) throw new Error('socket changed during stale check');
    await unlink(path);
  }
  const clients = new Set();
  const server = net.createServer(client => {
    if (clients.size >= 16) { client.destroy(); return; }
    clients.add(client); client.on('close', () => clients.delete(client));
    client.on('error', () => {}); client.setTimeout(3000, () => client.destroy());
    let data = '', done = false;
    client.on('data', chunk => {
      if (done) return;
      data += chunk;
      if (data.length > 1024) { client.destroy(); return; }
      if (!data.includes('\n')) return;
      done = true;
      try { client.end(JSON.stringify({ ok: true, value: state.command(JSON.parse(data.trim())) }) + '\n'); }
      catch (e) { client.end(JSON.stringify({ ok: false, error: e.message }) + '\n'); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  let owned;
  try { await chmod(path, 0o600); owned = await lstat(path); }
  catch (e) { for (const client of clients) client.destroy(); await new Promise(resolve => server.close(resolve)); throw e; }
  return async () => {
    for (const client of clients) client.destroy();
    await new Promise(resolve => server.close(resolve));
    const s = await stat(path);
    if (s?.ino === owned.ino && s.dev === owned.dev) await unlink(path);
    state.clear();
  };
}
