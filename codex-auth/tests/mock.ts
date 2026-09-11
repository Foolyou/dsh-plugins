import { CREDENTIAL_KEY } from '../src/protocol.ts';
import type { NativeServices, NativePrompt } from '../src/controller.ts';
export function mockServices() {
  let record: unknown;
  let running = false;
  let fail = false;
  let complete: (() => void) | undefined;
  let withdraw: (() => void) | undefined;
  let chosen: string | undefined;
  const services: NativeServices = {
    credentials: {
      readRecord: async key => { if (key !== CREDENTIAL_KEY) throw new Error('Wrong key'); return record; },
      deleteRecord: async key => { if (key !== CREDENTIAL_KEY) throw new Error('Wrong key'); record = undefined; },
    },
    authorization: {
      describe: () => ({ methods: [{ id: 'oauth' }], inFlight: running }),
      begin: async ({ signal, interaction }) => {
        running = true;
        try {
          if (fail) throw new Error('token error: secret-refresh-token secret-access-token');
          chosen = await interaction.prompt({ kind: 'select', message: 'Login method', options: [{ id: 'browser', label: 'Browser' }, { id: 'device_code', label: 'Device code' }] });
          if (signal.aborted) return { status: 'cancelled' };
          const callback = new AbortController();
          const device = new Promise<void>(resolve => { complete = resolve; });
          let manual: Promise<string> | undefined;
          if (chosen === 'device_code') interaction.notify({ message: 'Open the page and enter this code.', url: 'https://auth.openai.com/codex/device', code: 'TEST-1234' });
          else {
            interaction.notify({ message: 'Open browser.', url: 'https://auth.openai.com/oauth/authorize?state=test' });
            manual = interaction.prompt({ kind: 'text', message: 'Paste redirect URL', signal: callback.signal }).catch(error => {
              if (callback.signal.aborted && !signal.aborted) return device.then(() => 'callback');
              throw error;
            });
            // Model the native callback/manual-input race: withdrawing the losing
            // manual prompt must not cancel the whole successful flow.
            manual.catch(() => {});
          }
          withdraw = () => callback.abort();
          const stop = new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }); });
          await Promise.race([manual ?? device, device, stop]);
          if (signal.aborted) return { status: 'cancelled' };
          callback.abort();
          record = { kind: 'grant', payload: { type: 'oauth', access: 'secret-access-token', refresh: 'secret-refresh-token', accountId: 'private-account', expires: 1234567890000 } };
          return { status: 'authorized' };
        } finally { running = false; complete = undefined; withdraw = undefined; }
      },
    },
  };
  return { services, complete: () => complete?.(), withdraw: () => withdraw?.(), fail: () => { fail = true; }, chosen: () => chosen };
}
