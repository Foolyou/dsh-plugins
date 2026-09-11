/**
 * Durable portrait store owned by the host half.
 *
 * Layout below the configured root (default `$DSH_HOME/model-effort-slider`):
 *   `manifest.json`   ordered ids + revision, replaced atomically (tmp + rename)
 *   `portraits/<id>.png`  one normalized PNG per portrait, byte-for-byte as received
 *
 * Images live as files, never inside the manifest, so the document stays tiny
 * and each upload is a single atomic write. There is no portrait COUNT limit:
 * the only ceilings are per-image ({@link MAX_STORED_BYTES}) and total bytes
 * ({@link MAX_TOTAL_BYTES}), and a rejected request saves nothing.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isPng } from './bytes';
import { MAX_ADD_BATCH, MAX_STORED_BYTES, MAX_TOTAL_BYTES, PORTRAIT_ID, portraitUrl, type PortraitState } from './protocol';

/** Store failure carrying the HTTP status the route should answer with. */
export class PortraitError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'PortraitError';
  }
}

interface Manifest { version: 1; revision: number; ids: string[] }
interface Entry { id: string; bytes: number }

/** Bytes + filename of one incoming portrait, already read from the request. */
export interface PortraitUpload { name: string; bytes: Uint8Array }

export interface HostState {
  /** Drop anything cached from a previous medium; safe to call at any time. */
  reset(): Promise<void>;
  /** Current ordered portraits, each verified to exist and carry its real size. */
  read(): Promise<PortraitState>;
  /** Full PNG bytes of one portrait, or undefined when absent. */
  image(id: string): Promise<Uint8Array | undefined>;
  /** Append one batch. Rejects when any image is invalid; nothing is saved then. */
  add(uploads: readonly PortraitUpload[]): Promise<PortraitState>;
  /** Remove one id. No-op when it is already absent. */
  remove(id: string): Promise<PortraitState>;
  /** Swap one portrait with its neighbour. */
  move(id: string, delta: -1 | 1): Promise<PortraitState>;
  /** Remove every portrait and every stored file. */
  clear(): Promise<PortraitState>;
}

const EMPTY: Manifest = { version: 1, revision: 0, ids: [] };

function flag(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}

function assertId(id: string): string {
  if (!PORTRAIT_ID.test(id)) throw new PortraitError(400, '无效的图片标识。');
  return id;
}

/** Read the PNG's IHDR dimensions; the browser crops to a square, so both edges agree. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  // Signature (8) + chunk length (4) + 'IHDR' (4) + width (4) + height (4) = 24 bytes.
  if (!isPng(bytes) || bytes.length < 24) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function createHostState(root: string): HostState {
  const manifestPath = join(root, 'manifest.json');
  const portraitDir = join(root, 'portraits');
  const filePath = (id: string) => join(portraitDir, `${assertId(id)}.png`);
  // Serialize every mutation: two tabs uploading at once must not interleave
  // read-modify-write on the manifest.
  let chain: Promise<unknown> = Promise.resolve();
  const queue = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.then(() => undefined, () => undefined);
    return next;
  };

  async function load(): Promise<Manifest> {
    let raw: string;
    try { raw = await readFile(manifestPath, 'utf8'); }
    catch (error) { if (flag(error, 'ENOENT')) return { ...EMPTY }; throw error; }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { ...EMPTY };
      const value = parsed as Partial<Manifest>;
      if (value.version !== 1 || !Number.isSafeInteger(value.revision) || !Array.isArray(value.ids)) return { ...EMPTY };
      return { version: 1, revision: value.revision as number, ids: value.ids.filter((id): id is string => typeof id === 'string' && PORTRAIT_ID.test(id)) };
    } catch { return { ...EMPTY }; }
  }

  async function save(manifest: Manifest): Promise<void> {
    await mkdir(root, { recursive: true });
    const temporary = `${manifestPath}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temporary, `${JSON.stringify(manifest)}\n`);
    await rename(temporary, manifestPath);
  }

  async function stored(manifest: Manifest, revision = manifest.revision): Promise<PortraitState> {
    const portraits: PortraitState['portraits'] = [];
    for (const id of await present(manifest.ids)) {
      const bytes = await size(id);
      if (bytes !== undefined) portraits.push({ id, bytes, url: portraitUrl(id) });
    }
    return { revision, portraits };
  }

  /** Keep only ids whose file still exists, preserving order. */
  async function present(ids: readonly string[]): Promise<string[]> {
    const entries = new Set(await readdir(portraitDir).catch(() => [] as string[]));
    return ids.filter(id => entries.has(`${id}.png`));
  }

  async function size(id: string): Promise<number | undefined> {
    const bytes = await readFile(filePath(id)).catch(() => undefined);
    return bytes?.byteLength;
  }

  async function totalBytes(): Promise<number> {
    let total = 0;
    for (const name of await readdir(portraitDir).catch(() => [] as string[])) {
      if (!name.endsWith('.png') || !PORTRAIT_ID.test(name.slice(0, -4))) continue;
      total += (await readFile(join(portraitDir, name)).catch(() => undefined))?.byteLength ?? 0;
    }
    return total;
  }

  /** Validate a whole batch before writing anything, so a bad file never half-saves. */
  function validate(uploads: readonly PortraitUpload[]): Entry[] {
    if (!uploads.length) throw new PortraitError(400, '没有收到图片。');
    if (uploads.length > MAX_ADD_BATCH) throw new PortraitError(413, `每次最多上传 ${MAX_ADD_BATCH} 张图片。`);
    return uploads.map(({ name, bytes }) => {
      if (bytes.byteLength <= 0 || bytes.byteLength > MAX_STORED_BYTES) throw new PortraitError(413, '处理后的图片过大，请换一张图片。');
      if (!isPng(bytes) || pngSize(bytes)?.width !== 160 || pngSize(bytes)?.height !== 160) throw new PortraitError(415, `${name || '图片'} 不是有效的 160 × 160 PNG。`);
      return { id: randomBytes(12).toString('hex'), bytes: bytes.byteLength };
    });
  }

  return {
    reset: async () => { await queue(async () => {}); },
    read: () => queue(async () => stored(await load())),
    image: async id => {
      if (!PORTRAIT_ID.test(id)) return undefined;
      const bytes = await readFile(filePath(id)).catch(() => undefined);
      return bytes && isPng(bytes) ? new Uint8Array(bytes) : undefined;
    },
    add: uploads => queue(async () => {
      const entries = validate(uploads);
      await mkdir(portraitDir, { recursive: true });
      if (await totalBytes() + entries.reduce((sum, entry) => sum + entry.bytes, 0) > MAX_TOTAL_BYTES) {
        throw new PortraitError(413, '宿主端图片总量已达上限，请先移除部分图片。');
      }
      for (let index = 0; index < entries.length; index++) await writeFile(filePath(entries[index]!.id), uploads[index]!.bytes);
      const manifest = await load();
      const next: Manifest = { version: 1, revision: manifest.revision + 1, ids: [...manifest.ids, ...entries.map(entry => entry.id)] };
      await save(next);
      return stored(next);
    }),
    remove: id => queue(async () => {
      assertId(id);
      const manifest = await load();
      if (!manifest.ids.includes(id)) return stored(manifest);
      const next: Manifest = { version: 1, revision: manifest.revision + 1, ids: manifest.ids.filter(value => value !== id) };
      await save(next);
      await unlink(filePath(id)).catch(() => undefined);
      return stored(next);
    }),
    move: (id, delta) => queue(async () => {
      assertId(id);
      const manifest = await load();
      const from = manifest.ids.indexOf(id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= manifest.ids.length) return stored(manifest);
      const ids = [...manifest.ids];
      [ids[from], ids[to]] = [ids[to]!, ids[from]!];
      const next: Manifest = { version: 1, revision: manifest.revision + 1, ids };
      await save(next);
      return stored(next);
    }),
    clear: () => queue(async () => {
      const manifest = await load();
      const next: Manifest = { version: 1, revision: manifest.revision + 1, ids: [] };
      await save(next);
      for (const name of await readdir(portraitDir).catch(() => [] as string[])) {
        if (name.endsWith('.png') && PORTRAIT_ID.test(name.slice(0, -4))) await unlink(join(portraitDir, name)).catch(() => undefined);
      }
      return stored(next);
    }),
  };
}
