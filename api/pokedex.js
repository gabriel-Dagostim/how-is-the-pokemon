import { GameError } from '../lib/game.mjs';
import { failure, json } from '../lib/http.mjs';

export function createPokedexApi({ fetcher = fetch } = {}) {
  async function GET(request) {
    try {
      const params = new URL(request.url).searchParams;
      const kind = params.has('generation') ? 'generation' : 'pokemon';
      const value = params.get(kind);
      const id = Number(value);
      const max = kind === 'generation' ? 9 : 1025;
      if (params.size !== 1 || !/^\d+$/.test(value ?? '') || !Number.isInteger(id) || id < 1 || id > max) {
        throw new GameError('Consulta de Pokémon inválida.');
      }
      let response;
      try {
        response = await fetcher(`https://pokeapi.co/api/v2/${kind}/${id}/`, { signal: AbortSignal.timeout(7_000) });
      } catch {
        throw new GameError('PokéAPI indisponível. Tente novamente.', 502);
      }
      if (!response.ok) throw new GameError('PokéAPI indisponível. Tente novamente.', 502);
      let data;
      try { data = await response.json(); } catch { throw new GameError('PokéAPI enviou dados inválidos.', 502); }
      return Response.json(data, { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800', 'X-Content-Type-Options': 'nosniff' } });
    } catch (error) {
      return failure(error);
    }
  }
  return { GET, fetch: request => request.method === 'GET' ? GET(request) : json({ error: 'Método não permitido.' }, 405) };
}

const api = createPokedexApi();
export const GET = api.GET;
export default { fetch: api.fetch };
