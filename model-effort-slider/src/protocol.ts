/**
 * Wire contract shared by the host half (Node) and the browser half.
 *
 * Keep this module free of Node and DOM globals: it is bundled into both
 * artifacts. Only the exact API path, request field names, limits and the
 * types that cross `/api` belong here.
 */

/** Exact API route mounted by the host half; the browser half posts here. */
export const API_PATH = '/api/dsh-model-effort-slider';

/** Multipart field carrying the browser-normalized PNG. */
export const FILE_FIELD = 'file';
/** Multipart field carrying one mutation action. */
export const ACTION_FIELD = 'action';

export type PortraitAction = 'add' | 'remove' | 'move' | 'reset';

export const ACTIONS: readonly PortraitAction[] = ['add', 'remove', 'move', 'reset'];

/** One stored portrait: metadata plus its host-served URL. */
export interface PortraitInfo {
  /** Host-assigned opaque id; also the filename stem and stable React key. */
  id: string;
  /** Exact PNG byte length on the host. */
  bytes: number;
  /** Host-served path, relative to the page origin. */
  url: string;
}

/** One successful response body for every method on {@link API_PATH}. */
export interface PortraitState {
  /** Monotonic change counter; the browser half polls it to detect other tabs. */
  revision: number;
  /** Portraits in slider order, lowest effort first. */
  portraits: PortraitInfo[];
}

/** How many images a single request may add; no total count limit exists. */
export const MAX_ADD_BATCH = 32;
/** Per-image PNG budget, enforced by the host on the received bytes. */
export const MAX_STORED_BYTES = 512 * 1024;
/** Total PNG bytes kept on disk; exceeding it rejects the request, saves nothing. */
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
/** Source-file budget accepted by the browser before decoding. */
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
/** Source dimension budget accepted by the browser before decoding. */
export const MAX_SOURCE_DIMENSION = 4096;
/** Normalized square edge the browser crops to. */
export const PORTRAIT_SIZE = 160;
/** Accepted source MIME types; SVG and GIF are deliberately excluded. */
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Opaque portrait ids; strict enough to be used as filenames. */
export const PORTRAIT_ID = /^[A-Za-z0-9_-]{16,32}$/;

export function portraitUrl(id: string): string {
  return `${API_PATH}?id=${encodeURIComponent(id)}`;
}
