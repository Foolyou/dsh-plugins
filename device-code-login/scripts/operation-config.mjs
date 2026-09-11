/** Pure validation for opt-in maintenance scripts; importing this module does no I/O. */
import { isAbsolute, join, resolve, delimiter } from 'node:path';
import { access, realpath, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
export function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${name} must be explicitly configured`);
  return value;
}
export function originValue(value, name, { local = false, https = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a canonical origin`); }
  if (url.origin !== value || !['https:', 'http:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !LOOPBACK.has(url.hostname)) ||
      (local && !LOOPBACK.has(url.hostname)) || (https && url.protocol !== 'https:')) {
    throw new Error(`${name} must be canonical HTTPS or permitted loopback HTTP, without a path`);
  }
  return value;
}
export function explicitHome(env) {
  const home = required(env, 'DSH_HOME');
  if (!isAbsolute(home)) throw new Error('DSH_HOME must be an absolute directory path');
  return resolve(home);
}
export function explicitService(env) {
  const unit = required(env, 'DSH_SERVICE');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.@-]*\.service$/.test(unit)) throw new Error('DSH_SERVICE must be a single systemd service unit name');
  return unit;
}
export function browserConfig(env, args) {
  if (args.some(arg => arg !== '--restart-service') || args.length > 1) throw new Error('Usage: browser-smoke.mjs [--restart-service]');
  const localOrigin = originValue(required(env, 'DSH_LOCAL_ORIGIN'), 'DSH_LOCAL_ORIGIN', { local: true });
  const remoteOrigin = originValue(required(env, 'DSH_LOGIN_ORIGIN'), 'DSH_LOGIN_ORIGIN', { https: true });
  if (new URL(localOrigin).host === new URL(remoteOrigin).host) throw new Error('Local and remote test authorities must differ');
  const home = explicitHome(env);
  const restart = args.includes('--restart-service');
  return { localOrigin, remoteOrigin, home, restart, unit: restart ? explicitService(env) : undefined };
}
export function revokeConfig(env, args) {
  if (args.length !== 1 || args[0] !== '--confirm-revoke-all') throw new Error('Explicit --confirm-revoke-all required');
  const home = explicitHome(env), unit = explicitService(env);
  let origins;
  try { origins = JSON.parse(required(env, 'DSH_REVOKE_ORIGINS')); } catch { throw new Error('DSH_REVOKE_ORIGINS must be an explicit JSON array of origins'); }
  if (!Array.isArray(origins) || !origins.length || origins.length > 16 || origins.some(value => typeof value !== 'string')) {
    throw new Error('DSH_REVOKE_ORIGINS must contain 1 to 16 origins');
  }
  origins.forEach(origin => originValue(origin, 'DSH_REVOKE_ORIGINS'));
  if (new Set(origins.map(origin => new URL(origin).host)).size !== origins.length) throw new Error('Revocation origins must use distinct authorities');
  if (env.DSH_BIN !== undefined && !isAbsolute(required(env, 'DSH_BIN'))) throw new Error('DSH_BIN must be an absolute CLI entry path');
  return { home, unit, origins, filename: join(home, '.credentials.yaml') };
}
export async function resolveDshBin(env) {
  if (env.DSH_BIN !== undefined) {
    const path = await realpath(required(env, 'DSH_BIN'));
    if (!(await stat(path)).isFile()) throw new Error('DSH_BIN must name a regular CLI entry file');
    return path;
  }
  for (const directory of (env.PATH || '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, 'dsh');
    try { await access(candidate, constants.X_OK); if ((await stat(candidate)).isFile()) return await realpath(candidate); } catch {}
  }
  throw new Error('Set DSH_BIN explicitly or install dsh on PATH');
}
export async function assertOutsideService(unit) {
  if (process.platform !== 'linux') throw new Error('systemd operations require Linux');
  const cgroup = await readFile('/proc/self/cgroup', 'utf8');
  if (cgroup.split(/[\n/:]/).includes(unit)) throw new Error('Run from an independent terminal or systemd unit, not inside the target DSH service');
}
