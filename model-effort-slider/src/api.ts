/**
 * Browser-side transport for the host portrait store.
 *
 * One same-origin `/api` route serves both reads and mutations, authenticated
 * by the page's own Harness cookie, so nothing here handles tokens or ports.
 * Every mutation is atomic on the host: the response carries the full new
 * ordered state, which becomes the client's state verbatim.
 */
import { ACTION_FIELD, API_PATH, FILE_FIELD, type PortraitAction, type PortraitState } from './protocol';

/** Host answered, but refused (validation, quota, unknown id). */
export class PortraitRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'PortraitRequestError';
  }
}

/** Host half is not mounted at all (route absent or page unauthenticated). */
export class HostUnavailableError extends Error {
  constructor() { super('宿主端图片服务未加载（该插件的 Node 入口未注册到当前 profile）。'); this.name = 'HostUnavailableError'; }
}

export interface PortraitApi {
  read(signal?: AbortSignal): Promise<PortraitState>;
  add(files: readonly Blob[], signal?: AbortSignal): Promise<PortraitState>;
  remove(id: string, signal?: AbortSignal): Promise<PortraitState>;
  move(id: string, delta: -1 | 1, signal?: AbortSignal): Promise<PortraitState>;
  reset(signal?: AbortSignal): Promise<PortraitState>;
}

async function decode(response: Response): Promise<PortraitState> {
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new PortraitRequestError(response.status, '宿主端返回了无法解析的响应。'); }
  if (typeof body !== 'object' || body === null) throw new PortraitRequestError(response.status, '宿主端返回了无效的响应。');
  const value = body as { error?: unknown; revision?: unknown; portraits?: unknown };
  if (!response.ok) throw new PortraitRequestError(response.status, typeof value.error === 'string' ? value.error : `宿主端拒绝了请求（HTTP ${response.status}）。`);
  if (typeof value.revision !== 'number' || !Array.isArray(value.portraits)) throw new PortraitRequestError(response.status, '宿主端返回了无效的图片列表。');
  return value as PortraitState;
}

const form = (...entries: [string, string | Blob][]): FormData => {
  const body = new FormData();
  for (const [key, value] of entries) body.append(key, value);
  return body;
};

export function createPortraitApi(path = API_PATH, fetchImpl: typeof fetch = fetch): PortraitApi {
  async function call(init: RequestInit): Promise<PortraitState> {
    let response: Response;
    try { response = await fetchImpl(path, { ...init, credentials: 'same-origin', cache: 'no-store' }); }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new PortraitRequestError(0, `无法连接宿主端图片服务：${error instanceof Error ? error.message : String(error)}`);
    }
    // A missing route (404) or an unauthenticated page (401) both mean "no host half".
    if (response.status === 401 || response.status === 404) throw new HostUnavailableError();
    return decode(response);
  }
  const mutate = (action: PortraitAction, extra: [string, string | Blob][] = [], signal?: AbortSignal) =>
    call({ method: 'POST', body: form([ACTION_FIELD, action], ...extra), signal });
  return {
    read: signal => call({ method: 'GET', signal }),
    add: (files, signal) => mutate('add', files.map(file => [FILE_FIELD, file] as [string, Blob]), signal),
    remove: (id, signal) => mutate('remove', [['id', id]], signal),
    move: (id, delta, signal) => mutate('move', [['id', id], ['delta', String(delta)]], signal),
    reset: signal => mutate('reset', [], signal),
  };
}
