import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

test('servidor local serve só arquivos públicos e escuta no loopback por padrão', async () => {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['scripts/dev-server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), HOST: '' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 5_000;
    while (true) {
      try { await fetch(base); break; }
      catch { if (Date.now() > deadline || child.exitCode !== null) throw new Error('Servidor local não iniciou.'); await delay(25); }
    }
    for (const [route, status] of [
      ['/', 200], ['/app.js', 200], ['/style.css', 200], ['/Imagem/pokedex.png', 200],
      ['/.env.example', 404], ['/package.json', 404], ['/scripts/dev-server.mjs', 404], ['/lib/game.mjs', 404],
    ]) {
      assert.equal((await fetch(`${base}${route}`)).status, status, route);
    }
    await assert.rejects(fetch(`http://127.0.0.2:${port}/`, { signal: AbortSignal.timeout(500) }));
  } finally {
    child.kill();
  }
});
