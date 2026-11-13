import { GameError, advanceRoom, viewRoom } from '../lib/game.mjs';
import { updateStoredRoom, rateLimit } from '../lib/store.mjs';
import { imageForPhase } from '../lib/image.mjs';
import { redisFromEnv, roomCode, playerHash, clientId, json, failure } from '../lib/http.mjs';

export function createImageApi({ getRedis = redisFromEnv, fetcher = fetch, now = Date.now } = {}) {
  const handlers = {
    async GET(request) {
      try {
        const redis = await getRedis();
        await rateLimit(redis, `image-ip:${clientId(request)}`, 120, 60);
        const code = roomCode(new URL(request.url).searchParams.get('code'));
        const hash = playerHash(request.headers.get('x-player-token'));
        await rateLimit(redis, `image:${hash}`, 20, 60);
        const time = now();
        const room = await updateStoredRoom(redis, code, current => advanceRoom(current, time));
        viewRoom(room, hash, time);
        if (room.phase === 'lobby') throw new GameError('Imagem indisponível nesta fase.', 409);
        const id = room.questions[room.round - 1].id;
        let response;
        try {
          response = await fetcher(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`, {
            signal: AbortSignal.timeout(7_000),
          });
        } catch {
          throw new GameError('Imagem indisponível. Tente novamente.', 502);
        }
        if (!response.ok || !response.headers.get('content-type')?.includes('image/png') || Number(response.headers.get('content-length')) > 3_000_000) {
          throw new GameError('Imagem indisponível. Tente novamente.', 502);
        }
        const original = Buffer.from(await response.arrayBuffer());
        if (original.length > 3_000_000) throw new GameError('Imagem indisponível. Tente novamente.', 502);
        const image = await imageForPhase(original, room.phase);
        return new Response(image, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      } catch (error) {
        return failure(error);
      }
    },
  };
  return {
    ...handlers,
    fetch(request) {
      if (request.method === 'GET') return handlers.GET(request);
      return json({ error: 'Método não permitido.' }, 405);
    },
  };
}

const api = createImageApi();
export const GET = api.GET;
export default { fetch: api.fetch };
