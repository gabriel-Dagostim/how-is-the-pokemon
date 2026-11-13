import { createHash, randomBytes } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { GameError } from './game.mjs';

let redis;

export function redisFromEnv() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new GameError('Sala online indisponível: Redis não configurado.', 503);
  }
  return redis ??= Redis.fromEnv();
}

export function roomCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new GameError('Código da sala inválido.');
  return code;
}

export function playerHash(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(token)) {
    throw new GameError('Token de jogador inválido.', 401);
  }
  return createHash('sha256').update(token).digest('hex');
}

export function newToken() {
  return randomBytes(24).toString('base64url');
}

export function clientId(request) {
  const ip = request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  return createHash('sha256').update(ip.split(',')[0].trim()).digest('hex').slice(0, 24);
}

export function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function failure(error) {
  if (error instanceof GameError) return json({ error: error.message }, error.status);
  console.error('Pokémon API error:', error);
  return json({ error: 'Erro interno. Tente novamente.' }, 500);
}
