/**
 * Portrait state for the browser half.
 *
 * Portraits live on the host (`~/.dsh/model-effort-slider` by default), so this
 * module owns only: normalizing a picked file into a 160 × 160 PNG, talking to
 * {@link PortraitApi}, and one reactive store shared by the settings page and
 * every selector. Cross-tab changes arrive by polling the host's revision.
 *
 * There is no portrait COUNT limit. Only per-image limits apply, mirrored from
 * `protocol`; the host re-checks every limit on the received bytes.
 */
import { useSyncExternalStore } from 'react';
import { createPortraitApi, HostUnavailableError, PortraitRequestError, type PortraitApi } from './api';
import { dataUrlHeader, isPng } from './bytes';
import { ACCEPTED_TYPES, MAX_ADD_BATCH, MAX_SOURCE_BYTES, MAX_SOURCE_DIMENSION, MAX_STORED_BYTES, PORTRAIT_SIZE, type PortraitInfo, type PortraitState } from './protocol';

const DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const POLL_MS = 5000;

export interface PortraitsState {
  /** Ordered host portraits, lowest effort first. */
  portraits: readonly PortraitInfo[];
  error: string | null;
  /** True once the host answered; false means the Node half is missing. */
  hostAvailable: boolean;
  /** Concurrent mutations in flight. */
  busy: number;
}

export interface PortraitStore {
  getSnapshot(): PortraitsState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  add(files: readonly File[]): Promise<void>;
  move(id: string, delta: -1 | 1): Promise<void>;
  remove(id: string): Promise<void>;
  reset(): Promise<void>;
}

export interface StoreEnvironment {
  /** Browser: start revision polling, returning its disposer. */
  poll(onChange: () => void): () => void;
  prepare(file: File, signal: AbortSignal): Promise<Blob>;
}

const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

function loadImage(src: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => { clearTimeout(timer); image.onload = null; image.onerror = null; signal.removeEventListener('abort', abort); };
    const fail = (error: Error) => { cleanup(); image.src = ''; reject(error); };
    const abort = () => fail(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => fail(new Error('图片解码超时，请换一张图片。')), 10000);
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => fail(new Error('无法解码图片，请选择有效的图片文件。'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    image.src = src;
  });
}

function validateFile(file: Pick<File, 'size' | 'type'>, header: Uint8Array): void {
  if (!ACCEPTED_TYPES.includes(file.type as typeof ACCEPTED_TYPES[number])) throw new Error('请选择 PNG、JPEG 或 WebP 图片（不支持 SVG / GIF）。');
  if (file.size <= 0 || file.size > MAX_SOURCE_BYTES) throw new Error('每张图片必须大于 0 且不超过 2 MiB。');
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  const webp = String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
  if (!(file.type === 'image/png' ? isPng(header) : file.type === 'image/jpeg' ? jpeg : webp)) throw new Error('图片内容与文件类型不符。');
}

/** Decode locally and crop to a square PNG blob. Nothing is uploaded before this passes. */
export async function preparePortrait(file: File, signal: AbortSignal): Promise<Blob> {
  if (file.size <= 0 || file.size > MAX_SOURCE_BYTES) throw new Error('每张图片必须大于 0 且不超过 2 MiB。');
  validateFile(file, new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url, signal);
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > MAX_SOURCE_DIMENSION || image.naturalHeight > MAX_SOURCE_DIMENSION) {
      throw new Error('图片宽高必须在 1–4096 像素之间。');
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PORTRAIT_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理图片。');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
    const dataUrl = canvas.toDataURL('image/png');
    if (!DATA_URL.test(dataUrl)) throw new Error('处理后的图片过大，请换一张图片。');
    if (!isPng(dataUrlHeader(dataUrl))) throw new Error('处理后的图片格式无效，请换一张图片。');
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.size <= 0 || blob.size > MAX_STORED_BYTES) throw new Error('处理后的图片过大，请换一张图片。');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

export const browserEnvironment: StoreEnvironment = {
  poll: onChange => {
    const timer = window.setInterval(() => { if (!document.hidden) onChange(); }, POLL_MS);
    const wake = () => { if (!document.hidden) onChange(); };
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
  },
  prepare: preparePortrait,
};

/** One reactive store shared by the settings page and every selector. */
export function createPortraitStore(api: PortraitApi = createPortraitApi(), environment: StoreEnvironment = browserEnvironment): PortraitStore {
  let state: PortraitsState = { portraits: [], error: null, hostAvailable: true, busy: 0 };
  let revision: number | undefined;
  let unlisten: (() => void) | undefined;
  let hydration: AbortController | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: Partial<PortraitsState>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
  const apply = (next: PortraitState) => {
    revision = next.revision;
    publish({ portraits: next.portraits, hostAvailable: true, error: null });
  };
  const failed = (error: unknown) => publish({ hostAvailable: !(error instanceof HostUnavailableError), error: describe(error) });

  /** While subscribers exist, a host revision change updates every open tab. */
  async function poll(): Promise<void> {
    try {
      const next = await api.read();
      if (revision === undefined || next.revision !== revision) apply(next);
    } catch { /* a transient poll failure keeps the last good list */ }
  }

  async function refresh(): Promise<void> {
    hydration?.abort();
    const controller = new AbortController();
    hydration = controller;
    try {
      apply(await api.read(controller.signal));
    } catch (error) {
      if (!controller.signal.aborted) failed(error);
    } finally {
      if (hydration === controller) hydration = undefined;
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        unlisten = environment.poll(() => { void poll(); });
        void refresh();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { unlisten?.(); unlisten = undefined; hydration?.abort(); hydration = undefined; }
      };
    },
    refresh,
    async add(files) {
      if (!files.length || state.busy) return;
      const busy = state.busy + 1;
      const controller = new AbortController();
      publish({ busy, error: null });
      try {
        if (files.length > MAX_ADD_BATCH) throw new PortraitRequestError(413, `每次最多上传 ${MAX_ADD_BATCH} 张图片。`);
        // Sequential decode bounds memory use; a failed batch uploads nothing.
        const prepared: Blob[] = [];
        for (const file of files) prepared.push(await environment.prepare(file, controller.signal));
        apply(await api.add(prepared, controller.signal));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) failed(error);
      } finally { publish({ busy: Math.max(0, busy - 1) }); }
    },
    async move(id, delta) {
      if (state.busy) return;
      await mutate(signal => api.move(id, delta, signal));
    },
    async remove(id) {
      if (state.busy) return;
      await mutate(signal => api.remove(id, signal));
    },
    async reset() {
      if (state.busy) return;
      await mutate(signal => api.reset(signal));
    },
  };

  /** Run one mutation with a single owned busy slot; success adopts the host state. */
  async function mutate(task: (signal: AbortSignal) => Promise<PortraitState>): Promise<void> {
    const busy = state.busy + 1;
    const controller = new AbortController();
    publish({ busy, error: null });
    try { apply(await task(controller.signal)); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) failed(error); }
    finally { publish({ busy: Math.max(0, busy - 1) }); }
  }
}

export const portraitStore = createPortraitStore();
export function usePortraits(): PortraitsState { return useSyncExternalStore(portraitStore.subscribe, portraitStore.getSnapshot); }

/** Position of the slider node at `index` among `count`, in the portrait list. */
export function portraitIndex(index: number, count: number, portraits: number): number | undefined {
  return portraits === 0 ? undefined : Math.round((count <= 1 ? 0 : index / (count - 1)) * (portraits - 1));
}
