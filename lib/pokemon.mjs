import { GameError } from './game.mjs';

const TYPES = {
  normal: 'normal', fire: 'fogo', water: 'água', electric: 'elétrico', grass: 'planta', ice: 'gelo',
  fighting: 'lutador', poison: 'veneno', ground: 'terra', flying: 'voador', psychic: 'psíquico',
  bug: 'inseto', rock: 'pedra', ghost: 'fantasma', dragon: 'dragão', dark: 'sombrio',
  steel: 'aço', fairy: 'fada',
};
const format = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export async function fetchPokemon(redis, id, fetcher = fetch) {
  const key = `pokemon:species:${id}`;
  const cached = await redis.get(key);
  if (cached) return cached;
  let response;
  try {
    response = await fetcher(`https://pokeapi.co/api/v2/pokemon/${id}`, { signal: AbortSignal.timeout(7_000) });
  } catch {
    throw new GameError('PokéAPI indisponível. Tente iniciar novamente.', 502);
  }
  if (!response.ok) throw new GameError('PokéAPI indisponível. Tente iniciar novamente.', 502);
  let data;
  try { data = await response.json(); } catch { throw new GameError('PokéAPI indisponível. Tente iniciar novamente.', 502); }
  const art = data?.sprites?.other?.['official-artwork']?.front_default;
  if (data?.id !== id || typeof data?.name !== 'string' || !art || !Array.isArray(data.types)) {
    throw new GameError('Pokémon sem dados ou imagem para esta rodada.', 502);
  }
  const types = data.types.map(entry => TYPES[entry.type.name] ?? entry.type.name);
  const item = {
    id,
    name: data.name,
    hints: [
      `Tipo: ${types.join(' / ')}`,
      `Altura: ${format.format(data.height / 10)} m · Peso: ${format.format(data.weight / 10)} kg`,
    ],
  };
  await redis.set(key, item, { ex: 30 * 24 * 60 * 60 });
  return item;
}
