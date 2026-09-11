import { randomUUID } from 'node:crypto';
import { CREDENTIAL_KEY, type Action, type AttemptStatus, type AuthState, type Notice, type Prompt } from './protocol';

// Structural view of the native DSH authorization and credential services.
export type NativePrompt = Omit<Prompt, 'id'> & { signal?: AbortSignal };
export interface NativeServices {
  authorization: {
    describe(key: string): { methods: readonly { id: string }[]; inFlight: boolean } | undefined;
    begin(request: { key: string; method: string; signal: AbortSignal; interaction: {
      notify(notice: Notice): void; prompt(prompt: NativePrompt): Promise<string>;
    } }): Promise<{ status: 'authorized' | 'cancelled' }>;
  };
  credentials: {
    readRecord(key: string): Promise<unknown>;
    deleteRecord(key: string): Promise<void>;
  };
}
export class ActionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
interface Attempt {
  id: string; owner: string; status: AttemptStatus; notices: Notice[];
  prompt: Prompt | null; error: string | null; abort: AbortController;
  answer?: (value: string) => void; done: Promise<void>; timer?: ReturnType<typeof setTimeout>;
}
// Upstream authorization failures can embed token-response bodies in their
// message: pi-ai appends the raw HTTP body to token errors, and pi-ai's
// `ModelsError` folds its cause into its own message. `messageFor` therefore
// never renders upstream text. It walks the thrown error's chain only to match
// a whitelist of known signals, then returns a fixed sentence for that
// category; anything unrecognized keeps the generic fallback. Token bodies
// thus cannot reach the client through an error string.
interface FailureFacts { codes: Set<string>; text: string }
function failureFacts(error: unknown): FailureFacts {
  const codes = new Set<string>();
  const messages: string[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  // Bounded walk: wrapper -> cause -> AggregateError members is all that occurs.
  while (queue.length > 0 && seen.size < 32) {
    const value = queue.shift();
    if (value === null || value === undefined || seen.has(value)) continue;
    if (typeof value === 'string') { messages.push(value); continue; }
    if (typeof value !== 'object') continue;
    if (Array.isArray(value)) { queue.push(...value.slice(0, 8)); continue; }
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (typeof record.code === 'string') codes.add(record.code.toLowerCase());
    if (typeof record.name === 'string') codes.add(record.name.toLowerCase());
    if (typeof record.message === 'string') messages.push(record.message);
    if (typeof record.status === 'number') codes.add(String(record.status));
    queue.push(record.cause, record.errors);
  }
  return { codes, text: messages.join('\n').toLowerCase() };
}
const mentions = (text: string, ...markers: string[]) => markers.some(marker => text.includes(marker));
// Connection-level failures: Node system codes, undici codes, and TLS failures.
const NETWORK_CODES = [
  'enotfound', 'eai_again', 'eai_fail', 'eai_noname', 'econnrefused', 'econnreset', 'econnaborted',
  'etimedout', 'esockettimedout', 'ehostunreach', 'enetunreach', 'enetdown', 'ehostdown', 'epipe', 'eproto',
  'und_err_connect_timeout', 'und_err_socket', 'und_err_headers_timeout', 'und_err_body_timeout',
  'err_socket_connection_timeout', 'cert_has_expired', 'unable_to_verify_leaf_signature',
  'self_signed_cert_in_chain', 'depth_zero_self_signed_cert', 'err_tls_cert_altname_invalid',
];
// Ordered most specific first: a region-blocked token exchange is a 4xx too, so
// the region signal must win over the generic exchange-failure rule.
const FAILURE_RULES: readonly { test(facts: FailureFacts): boolean; message: string }[] = [
  {
    test: f => mentions(f.text, 'unsupported_country_region_territory', 'country, region, or territory not supported', 'not available in your country', 'not available in your region', 'region not supported', 'unsupported region'),
    message: 'OpenAI 授权服务不支持当前网络所在地区，请更换网络或代理后重试。',
  },
  {
    test: f => NETWORK_CODES.some(code => f.codes.has(code)) || mentions(f.text, 'fetch failed', 'getaddrinfo', 'socket hang up', 'network is unreachable', 'connection refused', 'connection reset'),
    message: '无法连接 OpenAI 授权服务，请检查网络、DNS 与代理设置后重试。',
  },
  {
    test: f => mentions(f.text, 'device code login is not enabled'),
    message: '此账号或工作区未启用设备码登录，请改用浏览器登录。',
  },
  {
    test: f => mentions(f.text, 'openai codex device code request failed', 'openai codex device auth failed', 'invalid openai codex device'),
    message: '设备码请求未被 OpenAI 接受，请稍后重试或改用浏览器登录。',
  },
  {
    test: f => /openai codex token (?:exchange|refresh) failed \(4\d\d\)/.test(f.text),
    message: 'OpenAI 拒绝了令牌换取请求（授权码可能已过期或已使用），请重新发起登录。',
  },
  {
    test: f => /openai codex token (?:exchange|refresh) failed \(5\d\d\)/.test(f.text),
    message: 'OpenAI 令牌服务暂时不可用，请稍后重试。',
  },
  {
    test: f => mentions(f.text, 'openai codex token exchange response missing fields', 'openai codex token refresh response missing fields', 'failed to extract accountid from token'),
    message: 'OpenAI 返回的登录数据不完整，请重新登录。',
  },
  {
    test: f => mentions(f.text, 'state mismatch', 'missing authorization code'),
    message: '未收到有效的授权码，请重新发起登录，或粘贴完整的浏览器跳转地址。',
  },
  {
    test: f => mentions(f.text, 'only available in node.js environments') || f.text.includes('unknown openai codex login method'),
    message: '当前运行环境不支持此登录方式，请重启 DSH 后重试。',
  },
  {
    test: f => f.codes.has('not_committed'),
    message: '授权流程未写入凭据，请重试。',
  },
  {
    test: f => f.codes.has('unknown_method'),
    message: '此授权方式不受支持，请刷新页面后重试。',
  },
];
const GENERIC_FAILURE = '授权未完成。请重试，或改用另一种登录方式。';
export const messageFor = (error: unknown): string => {
  const facts = failureFacts(error);
  if (facts.codes.has('already_in_flight')) return '已有授权正在进行，请稍后重试。';
  if (facts.codes.has('no_flow')) return 'Codex 授权服务尚未就绪。';
  for (const rule of FAILURE_RULES) if (rule.test(facts)) return rule.message;
  return GENERIC_FAILURE;
};
function publicNotice(notice: Notice): Notice {
  let url: string | undefined;
  try {
    const parsed = new URL(notice.url ?? '');
    if (parsed.protocol === 'https:' && ['auth.openai.com', 'chatgpt.com'].includes(parsed.hostname)) url = parsed.href;
  } catch { /* Plain progress notices have no URL. */ }
  return { message: notice.message.slice(0, 2000), ...(url ? { url } : {}), ...(notice.code ? { code: notice.code.slice(0, 100) } : {}) };
}
export class AuthController {
  private attempt?: Attempt;
  private disposed = false;
  private deleting = false;
  constructor(private services: NativeServices, private timeoutMs = 16 * 60_000) {}
  async state(owner: string): Promise<AuthState> {
    const entry = this.services.authorization.describe(CREDENTIAL_KEY);
    const record = await this.services.credentials.readRecord(CREDENTIAL_KEY);
    const payload = record && typeof record === 'object' && 'kind' in record && record.kind === 'grant' && 'payload' in record
      ? record.payload : undefined;
    const oauth = payload && typeof payload === 'object' && 'type' in payload && payload.type === 'oauth' ? payload : undefined;
    const expires = oauth && 'expires' in oauth ? oauth.expires : undefined;
    const mine = this.attempt?.owner === owner ? this.attempt : undefined;
    return {
      available: entry?.methods.some(m => m.id === 'oauth') ?? false,
      credential: { present: !!oauth, ...(typeof expires === 'number' && Number.isFinite(expires) ? { expiresAt: expires } : {}) },
      busyElsewhere: this.deleting || (!!entry?.inFlight && mine?.status !== 'running') || (!!this.attempt && this.attempt.status === 'running' && !mine),
      attempt: mine ? { id: mine.id, status: mine.status, notices: [...mine.notices], prompt: mine.prompt, error: mine.error } : null,
    };
  }
  async act(owner: string, action: Action): Promise<AuthState> {
    if (this.disposed) throw new ActionError(503, '插件正在重新加载，请稍后重试。');
    if (this.deleting) throw new ActionError(409, '正在退出登录，请稍候。');
    if (action.action === 'start') {
      if (this.attempt?.status === 'running' || this.services.authorization.describe(CREDENTIAL_KEY)?.inFlight) throw new ActionError(409, '已有授权正在进行，请在发起它的页面继续。');
      if (!this.services.authorization.describe(CREDENTIAL_KEY)?.methods.some(m => m.id === 'oauth')) throw new ActionError(503, '未找到 Codex OAuth 服务，请启用 llm-pi-ai。');
      this.start(owner, action.mode);
    } else if (action.action === 'logout') {
      if (this.attempt?.status === 'running' || this.services.authorization.describe(CREDENTIAL_KEY)?.inFlight) throw new ActionError(409, '请先取消正在进行的授权。');
      this.deleting = true;
      try { await this.services.credentials.deleteRecord(CREDENTIAL_KEY); this.attempt = undefined; }
      finally { this.deleting = false; }
    } else {
      const attempt = this.attempt;
      if (!attempt || attempt.owner !== owner || attempt.id !== action.attemptId || attempt.status !== 'running') throw new ActionError(409, '授权已结束或不属于此页面，请刷新状态。');
      if (action.action === 'cancel') { attempt.abort.abort(); await attempt.done; }
      else {
        if (!attempt.prompt || attempt.prompt.id !== action.promptId || !attempt.answer) throw new ActionError(409, '此问题已失效，请使用最新提示。');
        if (attempt.prompt.kind === 'select' && !attempt.prompt.options?.some(o => o.id === action.value)) throw new ActionError(400, '请选择列表中的选项。');
        const answer = attempt.answer; attempt.answer = undefined; attempt.prompt = null;
        answer(action.value);
      }
    }
    return this.state(owner);
  }
  private start(owner: string, mode: 'browser' | 'device_code') {
    const attempt: Attempt = { id: randomUUID(), owner, status: 'running', notices: [], prompt: null, error: null, abort: new AbortController(), done: Promise.resolve() };
    this.attempt = attempt;
    let modeChosen = false;
    attempt.timer = setTimeout(() => attempt.abort.abort(), this.timeoutMs);
    attempt.timer.unref();
    attempt.done = Promise.resolve().then(() => this.services.authorization.begin({
      key: CREDENTIAL_KEY, method: 'oauth', signal: attempt.abort.signal,
      interaction: {
        notify: notice => { if (!attempt.abort.signal.aborted && attempt.status === 'running') attempt.notices = [...attempt.notices.slice(-11), publicNotice(notice)]; },
        prompt: prompt => {
          if (attempt.abort.signal.aborted || prompt.signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
          // Use the requested native mode only if the native prompt offers it;
          // future/other questions remain visible, rather than guessing answers.
          if (!modeChosen && prompt.kind === 'select' && prompt.options?.some(o => o.id === mode)) { modeChosen = true; return Promise.resolve(mode); }
          if (attempt.prompt) return Promise.reject(new Error('Concurrent authorization prompts are unsupported'));
          return new Promise<string>((resolve, reject) => {
            const id = randomUUID();
            const cleanup = () => {
              attempt.abort.signal.removeEventListener('abort', cancel);
              prompt.signal?.removeEventListener('abort', cancel);
              if (attempt.prompt?.id === id) { attempt.prompt = null; attempt.answer = undefined; }
            };
            const cancel = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
            attempt.prompt = { id, kind: prompt.kind, message: prompt.message,
              ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}), ...(prompt.options ? { options: prompt.options } : {}) };
            attempt.answer = value => { cleanup(); resolve(value); };
            attempt.abort.signal.addEventListener('abort', cancel, { once: true });
            prompt.signal?.addEventListener('abort', cancel, { once: true });
          });
        },
      },
    })).then(outcome => { attempt.status = outcome.status; }, error => {
      attempt.status = attempt.abort.signal.aborted ? 'cancelled' : 'failed';
      if (attempt.status === 'failed') attempt.error = messageFor(error);
    }).finally(() => {
      clearTimeout(attempt.timer); attempt.abort.abort(); attempt.prompt = null; attempt.answer = undefined;
      // OAuth state parameters and device codes have no use once settled.
      attempt.notices = [];
    });
  }
  async dispose() {
    this.disposed = true;
    this.attempt?.abort.abort();
    await this.attempt?.done;
    this.attempt = undefined;
  }
}
