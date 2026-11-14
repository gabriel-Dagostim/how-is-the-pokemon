import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokedexApi } from '../api/pokedex.js';

test('proxy solo aceita só geração ou Pokémon válidos e guarda respostas no CDN', async () => {
  const calls = [];
  const api = createPokedexApi({ fetcher: async url => {
    calls.push(url);
    return Response.json({ id: 25, name: 'pikachu', height: 4, weight: 60,
      types: [{ type: { name: 'electric' } }],
      sprites: { other: { 'official-artwork': { front_default: 'https://example.com/25.png' } } },
      moves: Array(100).fill('unused'),
    });
  } });
  const generation = await api.fetch(new Request('https://example.com/api/pokedex?generation=1'));
  assert.equal(generation.status, 200);
  assert.match(generation.headers.get('cache-control'), /s-maxage=/);
  const { ids } = await generation.json();
  assert.equal(ids.length, 151);
  assert.equal(ids[0], 1);
  assert.equal(ids.at(-1), 151);
  const pokemon = await api.fetch(new Request('https://example.com/api/pokedex?pokemon=25'));
  assert.equal(pokemon.status, 200);
  assert.match(pokemon.headers.get('cache-control'), /s-maxage=/);
  assert.deepEqual(await pokemon.json(), { id: 25, name: 'pikachu', height: 4, weight: 60, types: ['electric'], artwork: 'https://example.com/25.png' });
  assert.deepEqual(calls, ['https://pokeapi.co/api/v2/pokemon/25/']);
  for (const query of ['generation=0', 'pokemon=1026', 'pokemon=25&generation=1', 'pokemon=abc']) {
    assert.equal((await api.fetch(new Request(`https://example.com/api/pokedex?${query}`))).status, 400);
  }
  assert.equal((await api.fetch(new Request('https://example.com/api/pokedex', { method: 'POST' }))).status, 405);
  assert.equal(calls.length, 1);
});

test('falha da PokéAPI não é armazenada no CDN', async () => {
  const api = createPokedexApi({ fetcher: async () => { throw new Error('offline'); } });
  const response = await api.fetch(new Request('https://example.com/api/pokedex?pokemon=25'));
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
