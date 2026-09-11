import { request as playwrightRequest } from '@playwright/test';

const API_PATH = '/api/dsh-model-effort-slider';
const BASE_URL = 'http://127.0.0.1:15082';

/**
 * Start every browser run from an empty host store. Playwright gives each test
 * its own browser context, so browser-side storage (including the old
 * `dsh.model-effort-slider.portraits.v1` key) never leaks between tests; host
 * files do, because one fixture server owns them for the whole run.
 */
export default async function reset(): Promise<void> {
  const context = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const state = await (await context.get(API_PATH)).json() as { portraits: { id: string }[] };
    for (const portrait of state.portraits) await context.post(API_PATH, { multipart: { action: 'remove', id: portrait.id } });
  } finally { await context.dispose(); }
}
