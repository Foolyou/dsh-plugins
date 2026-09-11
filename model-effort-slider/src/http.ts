/**
 * Host-side HTTP surface for the portrait store.
 *
 * Registered through `ctx.connection.fetch`, so the native carrier has already
 * applied Host/Origin trust and browser-cookie authentication before this
 * handler sees a request. Every mutation is one multipart POST on
 * {@link API_PATH}; GET returns state, GET `?id=<id>` the PNG bytes.
 */
import { bytesBuffer } from './bytes';
import { ACTIONS, ACTION_FIELD, API_PATH, FILE_FIELD, MAX_ADD_BATCH, MAX_STORED_BYTES, PORTRAIT_ID, type PortraitAction } from './protocol';
import { PortraitError, type HostState, type PortraitUpload } from './state';

const CACHE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CACHE });

function action(value: unknown): PortraitAction {
  if (typeof value !== 'string' || !ACTIONS.includes(value as PortraitAction)) throw new PortraitError(400, '无效的图片操作。');
  return value as PortraitAction;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !PORTRAIT_ID.test(value)) throw new PortraitError(400, '无效的图片标识。');
  return value;
}

/** Read every uploaded file out of an already-parsed multipart form. */
async function uploads(form: FormData): Promise<PortraitUpload[]> {
  const files = form.getAll(FILE_FIELD).filter((value): value is File => typeof value !== 'string');
  if (!files.length) throw new PortraitError(400, '没有收到图片。');
  if (files.length > MAX_ADD_BATCH) throw new PortraitError(413, `每次最多上传 ${MAX_ADD_BATCH} 张图片。`);
  return Promise.all(files.map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
}

/** One request handler bound to one store. */
export function createHandler(state: HostState): (request: Request) => Promise<Response> {
  return async request => {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (request.method === 'GET' || request.method === 'HEAD') {
        if (path !== API_PATH) throw new PortraitError(404, '未知的图片接口。');
        if (url.searchParams.has('id')) {
          const bytes = await state.image(identifier(url.searchParams.get('id')));
          if (!bytes) return json({ error: '图片不存在或已被移除。' }, 404);
          return new Response(request.method === 'HEAD' ? null : bytesBuffer(bytes), { headers: { ...CACHE, 'Content-Type': 'image/png', 'Content-Length': String(bytes.byteLength) } });
        }
        const response = json(await state.read());
        return request.method === 'HEAD' ? new Response(null, { headers: response.headers }) : response;
      }
      if (request.method !== 'POST' || path !== API_PATH) throw new PortraitError(405, '不支持此请求方法。');
      // One multipart read: the body stream cannot be consumed twice.
      const declared = Number(request.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_ADD_BATCH * (MAX_STORED_BYTES + 4096) + 8192) throw new PortraitError(413, '本次上传的图片过大或过多。');
      const form = await request.formData().catch(() => undefined);
      if (!form) throw new PortraitError(400, '需要 multipart 表单请求。');
      switch (action(form.get(ACTION_FIELD))) {
        case 'add': return json(await state.add(await uploads(form)));
        case 'remove': return json(await state.remove(identifier(form.get('id'))));
        case 'move': {
          const delta = Number(form.get('delta'));
          if (delta !== -1 && delta !== 1) throw new PortraitError(400, '无效的移动方向。');
          return json(await state.move(identifier(form.get('id')), delta));
        }
        case 'reset': return json(await state.clear());
      }
    } catch (error) {
      if (error instanceof PortraitError) return json({ error: error.message }, error.status);
      return json({ error: `宿主端无法处理图片请求：${error instanceof Error ? error.message : String(error)}` }, 500);
    }
  };
}
