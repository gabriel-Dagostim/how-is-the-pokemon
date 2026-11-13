import { randomInt } from 'node:crypto';
import { GameError, createRoom, joinRoom, assertCanStart, startRoom, answerRoom, hintRoom, advanceRoom, viewRoom, chooseIds, generationRange } from '../lib/game.mjs';
import { createStoredRoom, updateStoredRoom, rateLimit } from '../lib/store.mjs';
import { fetchPokemon } from '../lib/pokemon.mjs';
import { redisFromEnv, roomCode, playerHash, newToken, clientId, json, failure } from '../lib/http.mjs';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');

export function createRoomApi({ getRedis = redisFromEnv, fetcher = fetch, now = Date.now, pick = randomInt } = {}) {
  const handlers = {
    async GET(request) {
      try {
        const redis = await getRedis();
        await rateLimit(redis, `read-ip:${clientId(request)}`, 360, 60);
        const code = roomCode(new URL(request.url).searchParams.get('code'));
        const hash = playerHash(request.headers.get('x-player-token'));
        await rateLimit(redis, `read:${hash}`, 120, 60);
        const time = now();
        const room = await updateStoredRoom(redis, code, current => advanceRoom(current, time));
        return json(viewRoom(room, hash, time));
      } catch (error) {
        return failure(error);
      }
    },
    async POST(request) {
      try {
        if (!request.headers.get('content-type')?.includes('application/json')) throw new GameError('Envie JSON.', 415);
        const raw = await request.text();
        if (raw.length > 1_024) throw new GameError('Dados muito grandes.', 413);
        let body;
        try { body = JSON.parse(raw); } catch { throw new GameError('JSON inválido.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GameError('Dados inválidos.');
        const redis = await getRedis();
        await rateLimit(redis, `post-ip:${clientId(request)}`, 120, 60);
        if (body.action === 'create') {
          await rateLimit(redis, `create:${clientId(request)}`, 8, 60);
          await rateLimit(redis, 'create:global', 100, 60);
          const token = newToken();
          for (let attempt = 0; attempt < 10; attempt++) {
            const code = makeCode();
            const room = createRoom(code, body.name, playerHash(token), body.generation ?? 'all', now());
            if (await createStoredRoom(redis, room)) return json({ code, token }, 201);
          }
          throw new GameError('Não foi possível criar a sala. Tente novamente.', 503);
        }
        if (body.action === 'join') {
          await rateLimit(redis, `join:${clientId(request)}`, 30, 60);
          await rateLimit(redis, 'join:global', 120, 60);
          const code = roomCode(body.code);
          const token = newToken();
          await updateStoredRoom(redis, code, room => { joinRoom(room, body.name, playerHash(token)); return true; });
          return json({ code, token }, 201);
        }
        const code = roomCode(body.code);
        const hash = playerHash(body.token);
        await rateLimit(redis, `action:${hash}`, 60, 60);
        const time = now();
        if (body.action === 'start') {
          await rateLimit(redis, `start:${clientId(request)}`, 6, 60);
          await rateLimit(redis, 'start:global', 20, 60);
          const current = await redis.get(`pokemon:room:${code}`);
          if (!current) throw new GameError('Sala não encontrada ou expirada.', 404);
          assertCanStart(current, hash);
          const questions = await Promise.all(chooseIds(generationRange(current.generation), 10, pick)
            .map(id => fetchPokemon(redis, id, fetcher)));
          const startTime = now();
          const room = await updateStoredRoom(redis, code, value => { startRoom(value, hash, questions, startTime); return true; });
          return json(viewRoom(room, hash, startTime));
        }
        if (body.action === 'answer' || body.action === 'hint') {
          const room = await updateStoredRoom(redis, code, value => {
            if (body.action === 'answer') answerRoom(value, hash, body.answer, time);
            else hintRoom(value, hash, time);
            return true;
          });
          return json(viewRoom(room, hash, time));
        }
        throw new GameError('Ação inválida.');
      } catch (error) {
        return failure(error);
      }
    },
  };
  return {
    ...handlers,
    fetch(request) {
      if (request.method === 'GET') return handlers.GET(request);
      if (request.method === 'POST') return handlers.POST(request);
      return json({ error: 'Método não permitido.' }, 405);
    },
  };
}

const api = createRoomApi();
export const GET = api.GET;
export const POST = api.POST;
export const config = { maxDuration: 30 };
export default { fetch: api.fetch };
