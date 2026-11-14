import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRoomApi } from '../api/room.js';
import { createImageApi } from '../api/image.js';
import { redisFromEnv } from '../lib/http.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';

for (const envFile of ['.env.local', '.env']) {
  const full = path.join(ROOT_DIR, envFile);
  if (fs.existsSync(full) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(full);
  }
}

class MemoryRedis {
  #store = new Map();

  #read(key) {
    const entry = this.#store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      this.#store.delete(key);
      return null;
    }
    return structuredClone(entry.value);
  }

  async get(key) {
    return this.#read(key);
  }

  async set(key, value, opts = {}) {
    if (opts?.nx && this.#read(key) !== null) return null;
    const expiresAt = opts?.ex ? Date.now() + Number(opts.ex) * 1000 : null;
    this.#store.set(key, { value: structuredClone(value), expiresAt });
    return 'OK';
  }

  async eval(_script, [key], args) {
    if (args.length === 3) {
      const current = this.#read(key);
      if (!current) return -1;
      if (current.version !== Number(args[0])) return 0;
      const ttl = Number(args[2]);
      const expiresAt = Number.isFinite(ttl) && ttl > 0 ? Date.now() + ttl * 1000 : null;
      this.#store.set(key, { value: JSON.parse(args[1]), expiresAt });
      return 1;
    }
    const existing = this.#store.get(key);
    const expired = existing?.expiresAt && Date.now() >= existing.expiresAt;
    const next = (expired ? 0 : Number(existing?.value ?? 0)) + 1;
    const ttl = Number(args[0]);
    const expiresAt = existing && !expired && existing.expiresAt
      ? existing.expiresAt
      : Number.isFinite(ttl) && ttl > 0
        ? Date.now() + ttl * 1000
        : null;
    this.#store.set(key, { value: next, expiresAt });
    return next;
  }
}

const memoryRedis = new MemoryRedis();
const useUpstash = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const getRedis = () => (useUpstash ? redisFromEnv() : memoryRedis);

const roomApi = createRoomApi({ getRedis });
const imageApi = createImageApi({ getRedis });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};
const PUBLIC_FILES = new Set(['index.html', 'app.js', 'style.css', 'Imagem/pokedex.png']);

function toWebRequest(req, origin) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else if (value !== undefined) headers.set(key, value);
  }
  if (!headers.has('x-forwarded-for') && req.socket?.remoteAddress) {
    headers.set('x-forwarded-for', req.socket.remoteAddress);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(new URL(req.url || '/', origin), {
    method: req.method,
    headers,
    ...(hasBody ? { body: req, duplex: 'half' } : {}),
  });
}

async function sendWebResponse(res, webRes) {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => res.setHeader(key, value));
  const body = Buffer.from(await webRes.arrayBuffer());
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const hostHeader = req.headers.host || `127.0.0.1:${PORT}`;
    const origin = `http://${hostHeader}`;
    const url = new URL(req.url || '/', origin);

    if (url.pathname === '/api/room') {
      const response = await roomApi.fetch(toWebRequest(req, origin));
      await sendWebResponse(res, response);
      return;
    }

    if (url.pathname === '/api/image') {
      const response = await imageApi.fetch(toWebRequest(req, origin));
      await sendWebResponse(res, response);
      return;
    }

    const reqPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const relative = reqPath.replace(/^\/+/, '');
    if (!PUBLIC_FILES.has(relative)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não encontrado.');
      return;
    }
    const filePath = path.join(ROOT_DIR, relative);

    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não encontrado.');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error('Arena Dex dev server error:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Erro interno no servidor local.' }));
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Arena Dex local server running on http://localhost:${PORT} (network ${HOST}:${PORT})`);
  console.log(`Room store mode: ${useUpstash ? 'Upstash Redis' : 'In-memory local store'}`);
});
