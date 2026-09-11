import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageFor } from '../src/controller.ts';

// Every classified message is a fixed string: the upstream text is matched but
// never rendered, so no case below may echo a marker it matched on.
const expectCategory = (label: string, error: unknown, expected: string, secret?: string) => {
  const message = messageFor(error);
  assert.equal(message, expected, label);
  assert.equal(message.includes('secret'), false, `${label} echoed a secret`);
  if (secret) assert.equal(message.includes(secret), false, `${label} echoed upstream text`);
};

test('classifies a region block even when it arrives as a 4xx token exchange', () => {
  expectCategory(
    'region',
    new Error('OpenAI Codex token exchange failed (403): {"error":{"code":"unsupported_country_region_territory"}}'),
    'OpenAI 授权服务不支持当前网络所在地区，请更换网络或代理后重试。',
    'unsupported_country_region_territory',
  );
});

test('walks the cause chain to the region signal', () => {
  const cause = Object.assign(new Error('Country, region, or territory not supported'), { code: 'unsupported_country_region_territory' });
  expectCategory(
    'region cause',
    new Error('Credential store modify failed for openai-codex', { cause }),
    'OpenAI 授权服务不支持当前网络所在地区，请更换网络或代理后重试。',
  );
});

test('classifies network failures from system codes, fetch wrappers and aggregate members', () => {
  const network = '无法连接 OpenAI 授权服务，请检查网络、DNS 与代理设置后重试。';
  const dns = Object.assign(new Error('getaddrinfo ENOTFOUND auth.openai.com'), { code: 'ENOTFOUND' });
  expectCategory('dns', dns, network);
  expectCategory('fetch wrapper', new TypeError('fetch failed', { cause: dns }), network);
  expectCategory('aggregate', new AggregateError([dns, new Error('timeout')], 'all failed'), network);
  expectCategory('undici', Object.assign(new Error('connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }), network);
  expectCategory('tls', Object.assign(new Error('self signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }), network);
});

test('classifies the disabled device-code login signal', () => {
  expectCategory(
    'device code disabled',
    new Error('OpenAI Codex device code login is not enabled for this server. Use browser login or verify the server URL.'),
    '此账号或工作区未启用设备码登录，请改用浏览器登录。',
  );
});

test('classifies rejected device-code requests instead of echoing their body', () => {
  expectCategory(
    'device request',
    new Error('OpenAI Codex device code request failed with status 403: {"error":{"message":"access denied"}}'),
    '设备码请求未被 OpenAI 接受，请稍后重试或改用浏览器登录。',
    'access denied',
  );
});

test('classifies 4xx token exchange failures without echoing the response body', () => {
  const expected = 'OpenAI 拒绝了令牌换取请求（授权码可能已过期或已使用），请重新发起登录。';
  expectCategory('400', new Error('OpenAI Codex token exchange failed (400): {"error":"invalid_grant","access_token":"secret-leak"}'), expected, 'invalid_grant');
  expectCategory('401', new Error('OpenAI Codex token exchange failed (401)'), expected);
  expectCategory('refresh', new Error('OpenAI Codex token refresh failed (400): {"refresh_token":"secret-leak"}'), expected, 'refresh_token');
});

test('classifies 5xx and malformed token responses separately', () => {
  expectCategory('500', new Error('OpenAI Codex token exchange failed (500): upstream boom'), 'OpenAI 令牌服务暂时不可用，请稍后重试。', 'upstream boom');
  expectCategory(
    'missing fields',
    new Error('OpenAI Codex token exchange response missing fields: {"access_token":"secret-leak"}'),
    'OpenAI 返回的登录数据不完整，请重新登录。',
    'access_token',
  );
  expectCategory('account id', new Error('Failed to extract accountId from token'), 'OpenAI 返回的登录数据不完整，请重新登录。');
});

test('classifies browser callback and environment failures', () => {
  const callback = '未收到有效的授权码，请重新发起登录，或粘贴完整的浏览器跳转地址。';
  expectCategory('state', new Error('State mismatch'), callback);
  expectCategory('missing code', new Error('Missing authorization code'), callback);
  expectCategory('node only', new Error('OpenAI Codex OAuth is only available in Node.js environments'), '当前运行环境不支持此登录方式，请重启 DSH 后重试。');
});

test('classifies stable DSH failure codes carried on the error chain', () => {
  expectCategory('in flight', Object.assign(new Error('already running'), { code: 'ALREADY_IN_FLIGHT' }), '已有授权正在进行，请稍后重试。');
  expectCategory('no flow', Object.assign(new Error('unregistered'), { code: 'NO_FLOW' }), 'Codex 授权服务尚未就绪。');
  expectCategory('not committed', Object.assign(new Error('nothing committed'), { code: 'NOT_COMMITTED' }), '授权流程未写入凭据，请重试。');
  expectCategory('unknown method', Object.assign(new Error('no such method'), { code: 'UNKNOWN_METHOD' }), '此授权方式不受支持，请刷新页面后重试。');
});

test('unknown failures keep the neutral fallback and never echo the thrown value', () => {
  const fallback = '授权未完成。请重试，或改用另一种登录方式。';
  expectCategory('opaque token error', new Error('token error: secret-refresh-token secret-access-token'), fallback);
  expectCategory('plain string', 'upstream said: secret-access-token', fallback);
  expectCategory('non-error', 42, fallback);
});
