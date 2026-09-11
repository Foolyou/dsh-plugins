import { ActionError, type AuthController } from './controller';
import type { Action } from './protocol';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
export function parseAction(value: unknown): Action {
  if (!value || typeof value !== 'object') throw new ActionError(400, '无效请求。');
  const v = value as Record<string, unknown>;
  if (v.action === 'start' && (v.mode === 'browser' || v.mode === 'device_code')) return { action: 'start', mode: v.mode };
  if (v.action === 'logout') return { action: 'logout' };
  if (v.action === 'cancel' && text(v.attemptId, 64)) return { action: 'cancel', attemptId: v.attemptId };
  if (v.action === 'answer' && text(v.attemptId, 64) && text(v.promptId, 64) && text(v.value, 8192)) return { action: 'answer', attemptId: v.attemptId, promptId: v.promptId, value: v.value };
  throw new ActionError(400, '无效操作或参数。');
}
// Registered only through Connection.fetch: the native carrier first checks
// Host, Origin and the authenticated Harness cookie for every request.
export function handler(controller: AuthController) {
  return async (request: Request): Promise<Response> => {
    try {
      const owner = request.headers.get('X-DSH-Auth-Owner') ?? '';
      if (!/^[a-f0-9-]{36}$/.test(owner)) throw new ActionError(400, '缺少有效的页面标识。');
      if (request.method === 'GET') return json(await controller.state(owner));
      if (request.method !== 'POST') throw new ActionError(405, '不支持此请求方法。');
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ActionError(415, '需要 JSON 请求。');
      const raw = await request.text();
      if (raw.length > 12_000) throw new ActionError(413, '请求过大。');
      let body: unknown;
      try { body = JSON.parse(raw); } catch { throw new ActionError(400, '无效 JSON。'); }
      return json(await controller.act(owner, parseAction(body)));
    } catch (error) {
      return json({ error: error instanceof ActionError ? error.message : '无法读取或更新授权状态，请重试。' }, error instanceof ActionError ? error.status : 500);
    }
  };
}
