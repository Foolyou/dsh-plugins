import { useSyncExternalStore } from 'react';

export const STORAGE_KEY = 'dsh.model-effort-slider.portraits.v1';
export const MAX_PORTRAITS = 6;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_DIMENSION = 4096;
export const PORTRAIT_SIZE = 160;
export const MAX_PORTRAIT_CHARS = 160 * 1024;
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_STORED_CHARS = MAX_PORTRAITS * MAX_PORTRAIT_CHARS + 100;
export interface PortraitState { portraits: readonly string[]; error: string | null }

export function portraitIndex(index: number, count: number, portraits: number): number | undefined {
  return portraits === 0 ? undefined : Math.round((count <= 1 ? 0 : index / (count - 1)) * (portraits - 1));
}

export function validateFile(file: Pick<File, 'size' | 'type'>, bytes: Uint8Array) {
  if (!ACCEPTED_TYPES.includes(file.type as typeof ACCEPTED_TYPES[number])) throw new Error('请选择 PNG、JPEG 或 WebP 图片（不支持 SVG / GIF）。');
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('每张图片必须大于 0 且不超过 2 MiB。');
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!(file.type === 'image/png' ? png : file.type === 'image/jpeg' ? jpeg : webp)) throw new Error('图片内容与文件类型不匹配。');
}

function loadImage(src: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => { clearTimeout(timer); image.onload = null; image.onerror = null; signal?.removeEventListener('abort', abort); };
    const fail = (error: Error) => { cleanup(); image.src = ''; reject(error); };
    const abort = () => fail(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => fail(new Error('图片解码超时，请换一张图片。')), 10000);
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => fail(new Error('无法解码图片，请选择有效的图片文件。'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    image.src = src;
  });
}

/** Decode locally, crop to a small square and re-encode. Never send files to DSH. */
export async function preparePortrait(file: File, signal?: AbortSignal): Promise<string> {
  // Check byte count before reading even a header from an oversized file.
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('每张图片必须大于 0 且不超过 2 MiB。');
  validateFile(file, new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url, signal);
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > MAX_DIMENSION || image.naturalHeight > MAX_DIMENSION) {
      throw new Error('图片宽高必须在 1–4096 像素之间。');
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PORTRAIT_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理图片。');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
    const result = canvas.toDataURL('image/png');
    if (!isPortrait(result)) throw new Error('处理后的图片过大或无法保存，请换一张图片。');
    return result;
  } finally { URL.revokeObjectURL(url); }
}

function isPortrait(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PORTRAIT_CHARS && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function parsePortraits(raw: string | null): string[] {
  if (raw === null) return [];
  if (raw.length > MAX_STORED_CHARS) throw new Error('保存的图片数据过大，请重置。');
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('portraits' in data) ||
    !Array.isArray(data.portraits) || data.portraits.length > MAX_PORTRAITS || !data.portraits.every(isPortrait)) {
    throw new Error('保存的图片数据无效，请重置。');
  }
  return data.portraits;
}

async function decodeStored(src: string, signal?: AbortSignal) {
  const image = await loadImage(src, signal);
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > PORTRAIT_SIZE || image.naturalHeight > PORTRAIT_SIZE) throw new Error('保存的图片无法解码或尺寸无效，请重置。');
}

interface StorageFace { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
interface StoreEnvironment {
  storage(): StorageFace;
  listen(refresh: () => void): () => void;
  decode(src: string, signal?: AbortSignal): Promise<void>;
}
const browserEnvironment: StoreEnvironment = {
  storage: () => window.localStorage,
  listen: refresh => {
    const listener = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      try { if (event.storageArea === window.localStorage) refresh(); }
      catch { refresh(); } // refresh reports inaccessible storage without throwing in the event handler.
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  },
  decode: decodeStored,
};

/** One reactive store shared by settings and every selector; writes are transactional. */
export function createPortraitStore(environment: StoreEnvironment = browserEnvironment) {
  let state: PortraitState = { portraits: [], error: null };
  let revision = 0;
  let hydration: AbortController | undefined;
  let unlisten: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: PortraitState) => { state = next; listeners.forEach(fn => fn()); };
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);
  async function refresh() {
    const version = ++revision;
    hydration?.abort();
    const controller = new AbortController(); hydration = controller;
    try {
      const portraits = parsePortraits(environment.storage().getItem(STORAGE_KEY));
      // Stored browser data is untrusted; never render arbitrary URLs or undecoded payloads.
      await Promise.all(portraits.map(src => environment.decode(src, controller.signal)));
      if (version === revision) publish({ portraits, error: null });
    } catch (error) {
      if (version === revision) publish({ portraits: [], error: `无法读取本地图片：${message(error)}` });
    } finally {
      controller.abort();
      if (hydration === controller) hydration = undefined;
    }
  }
  function save(portraits: readonly string[]) {
    ++revision; hydration?.abort(); hydration = undefined;
    try {
      if (portraits.length > MAX_PORTRAITS || !portraits.every(isPortrait)) throw new Error('最多保存六张有效图片。');
      if (portraits.length) environment.storage().setItem(STORAGE_KEY, JSON.stringify({ version: 1, portraits }));
      else environment.storage().removeItem(STORAGE_KEY);
      publish({ portraits: [...portraits], error: null });
      return true;
    } catch (error) {
      publish({ ...state, error: `无法保存本地图片（存储已满或被禁用）：${message(error)}` });
      return false;
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      if (listeners.size === 1) { unlisten = environment.listen(() => { void refresh(); }); void refresh(); }
      return () => { listeners.delete(fn); if (!listeners.size) { unlisten?.(); unlisten = undefined; ++revision; hydration?.abort(); hydration = undefined; } };
    },
    refresh,
    save,
    reset: () => save([]),
  };
}
export const portraitStore = createPortraitStore();
export function usePortraits() { return useSyncExternalStore(portraitStore.subscribe, portraitStore.getSnapshot); }
