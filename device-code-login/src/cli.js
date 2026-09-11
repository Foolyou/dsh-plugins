#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { socketPath, callSocket } from './socket.js';
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: dsh-device-auth [--home DSH_HOME] list | approve CODE [--yes] | deny CODE\nApproval uses an owner-only local UNIX socket. Approve only requests you initiated.'); return;
  }
  let home; const flags = new Set(); const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--home') { home = args[++i]; if (!home || home.startsWith('--')) throw new Error('--home requires a path'); }
    else if (args[i] === '--yes') flags.add('yes');
    else if (args[i].startsWith('--')) throw new Error('unknown option');
    else positional.push(args[i]);
  }
  const [action, rawCode] = positional;
  if (!['list', 'approve', 'deny'].includes(action) || positional.length !== (action === 'list' ? 1 : 2)) throw new Error('Usage: dsh-device-auth [--home DSH_HOME] list | approve CODE [--yes] | deny CODE');
  const path = socketPath(home), code = rawCode?.toUpperCase();
  if (code && !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) throw new Error('Invalid authorization code');
  if (action === 'approve') {
    const row = await callSocket(path, { action: 'inspect', code });
    console.log('Request metadata (self-reported / proxy-visible; NOT a verified identity):');
    console.log(JSON.stringify(row, null, 2));
    if (!flags.has('yes')) {
      if (!process.stdin.isTTY) throw new Error('Interactive confirmation required; use --yes only for a request you initiated');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { if ((await rl.question(`Approve ${code}? Type yes: `)).trim() !== 'yes') throw new Error('Approval cancelled'); }
      finally { rl.close(); }
    }
  }
  console.log(JSON.stringify(await callSocket(path, { action, code }), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
