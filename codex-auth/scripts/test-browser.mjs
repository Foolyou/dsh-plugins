import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const server = spawn(process.execPath, ['--import', 'tsx', 'scripts/serve-test.ts'], { stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture startup timed out')), 15000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Fixture exited: ${code}`)); });
    server.stdout.on('data', data => { if (data.toString().includes('fixture-ready')) { clearTimeout(timeout); resolve(); } });
  });
  const cli = join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
  const runner = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exitCode = await new Promise((resolve, reject) => { runner.on('exit', code => resolve(code ?? 1)); runner.on('error', reject); });
} finally { server.kill(); }
