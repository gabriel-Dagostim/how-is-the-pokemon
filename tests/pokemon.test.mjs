import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPokemon } from '../lib/pokemon.mjs';

test('PokéAPI details become Portuguese hints and are cached by ID', async () => {
  const values = new Map();
  const redis = {
    get: async key => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); return 'OK'; },
  };
  let requests = 0;
  const fetcher = async () => {
    requests++;
    return { ok: true, json: async () => ({
      id: 25, name: 'pikachu', height: 4, weight: 60,
      types: [{ type: { name: 'electric' } }],
      sprites: { other: { 'official-artwork': { front_default: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png' } } },
    }) };
  };
  const first = await fetchPokemon(redis, 25, fetcher);
  const second = await fetchPokemon(redis, 25, fetcher);
  assert.equal(requests, 1);
  assert.deepEqual(second, first);
  assert.deepEqual(first.hints, ['Tipo: elétrico', 'Altura: 0,4 m · Peso: 6 kg']);
  assert.equal(first.name, 'pikachu');
});

test('a failed PokéAPI response does not cache a broken question', async () => {
  let writes = 0;
  const redis = { get: async () => null, set: async () => { writes++; } };
  await assert.rejects(fetchPokemon(redis, 25, async () => ({ ok: false, status: 503 })), error => error.status === 502);
  assert.equal(writes, 0);
  await assert.rejects(fetchPokemon(redis, 25, async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } })), error => error.status === 502);
  assert.equal(writes, 0);
});
