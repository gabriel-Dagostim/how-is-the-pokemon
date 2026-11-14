import { GameError, generationRange } from '../lib/game.mjs';
import { failure, json } from '../lib/http.mjs';

const CACHE = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800', 'X-Content-Type-Options': 'nosniff' };

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
      if (kind === 'generation') {
        const [first, last] = generationRange(id);
        return Response.json({ ids: Array.from({ length: last - first + 1 }, (_, index) => first + index) }, { headers: CACHE });
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
      const artwork = data.sprites?.other?.['official-artwork']?.front_default || data.sprites?.front_default;
      const types = data.types?.map(entry => entry.type?.name).filter(Boolean);
      if (data.id !== id || !data.name || !artwork || !types?.length) throw new GameError('Pokémon sem dados para esta rodada.', 502);
      return Response.json({ id, name: data.name, height: data.height, weight: data.weight, types, artwork }, { headers: CACHE });
    } catch (error) {
      return failure(error);
    }
  }
  return { GET, fetch: request => request.method === 'GET' ? GET(request) : json({ error: 'Método não permitido.' }, 405) };
}

const api = createPokedexApi();
export const GET = api.GET;
export default { fetch: api.fetch };
