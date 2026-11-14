import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokedexApi } from '../api/pokedex.js';

test('proxy solo aceita só geração ou Pokémon válidos e guarda respostas no CDN', async () => {
  const calls = [];
  const api = createPokedexApi({ fetcher: async url => {
    calls.push(url);
    return Response.json({ ok: true });
  } });
  for (const query of ['generation=1', 'pokemon=25']) {
    const response = await api.fetch(new Request(`https://example.com/api/pokedex?${query}`));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /s-maxage=/);
    assert.deepEqual(await response.json(), { ok: true });
  }
  assert.deepEqual(calls, ['https://pokeapi.co/api/v2/generation/1/', 'https://pokeapi.co/api/v2/pokemon/25/']);
  for (const query of ['generation=0', 'pokemon=1026', 'pokemon=25&generation=1', 'pokemon=abc']) {
    assert.equal((await api.fetch(new Request(`https://example.com/api/pokedex?${query}`))).status, 400);
  }
  assert.equal((await api.fetch(new Request('https://example.com/api/pokedex', { method: 'POST' }))).status, 405);
  assert.equal(calls.length, 2);
});

test('falha da PokéAPI não é armazenada no CDN', async () => {
  const api = createPokedexApi({ fetcher: async () => { throw new Error('offline'); } });
  const response = await api.fetch(new Request('https://example.com/api/pokedex?pokemon=25'));
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
