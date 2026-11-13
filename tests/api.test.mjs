import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createRoomApi } from '../api/room.js';
import { createImageApi } from '../api/image.js';

class RedisFake {
  values = new Map();
  async get(key) { return structuredClone(this.values.get(key) ?? null); }
  async set(key, value, opts) {
    if (opts?.nx && this.values.has(key)) return null;
    this.values.set(key, structuredClone(value));
    return 'OK';
  }
  async eval(_script, [key], args) {
    if (args.length === 3) {
      const current = this.values.get(key);
      if (!current) return -1;
      if (current.version !== Number(args[0])) return 0;
      this.values.set(key, JSON.parse(args[1]));
      return 1;
    }
    const count = Number(this.values.get(key) ?? 0) + 1;
    this.values.set(key, count);
    return count;
  }
}

function post(api, body) {
  return api.fetch(new Request('https://example.com/api/room', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': '127.0.0.1' }, body: JSON.stringify(body),
  }));
}

test('room API creates and joins anonymously, enforces 2s prep lock, keeps answers off the wire, and scores server-side', async () => {
  const redis = new RedisFake();
  let now = 1_000_000;
  let firstFetch = true;
  const fetcher = async url => {
    if (firstFetch) { now += 9_000; firstFetch = false; }
    return { ok: true, json: async () => ({
      id: Number(url.split('/').at(-1)), name: 'pikachu', height: 4, weight: 60,
      types: [{ type: { name: 'electric' } }],
      sprites: { other: { 'official-artwork': { front_default: 'https://example.com/pikachu.png' } } },
    }) };
  };
  const api = createRoomApi({ getRedis: () => redis, fetcher, now: () => now, pick: () => 0 });
  const createdResponse = await post(api, { action: 'create', name: 'Gabriel', generation: 1 });
  assert.equal(createdResponse.status, 201);
  const { code, token: hostToken } = await createdResponse.json();
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.match(hostToken, /^[A-Za-z0-9_-]{32}$/);
  const joinedResponse = await post(api, { action: 'join', code, name: 'Ana' });
  assert.equal(joinedResponse.status, 201);
  const { token: anaToken } = await joinedResponse.json();
  assert.notEqual(hostToken, anaToken);
  assert.equal((await post(api, { action: 'start', code, token: hostToken })).status, 200);
  const get = token => api.fetch(new Request(`https://example.com/api/room?code=${code}`, { headers: { 'x-player-token': token } }));
  assert.equal((await get('invalid')).status, 401);
  const question = await (await get(hostToken)).json();
  assert.equal(question.phase, 'question');
  assert.equal(question.round, 1);
  assert.equal(question.prepRemainingMs, 2_000);
  assert.equal(question.remainingMs, 30_000);
  assert.equal(question.answer, undefined);
  assert.equal(JSON.stringify(question).includes('pikachu'), false);
  assert.equal(question.imageUrl, `/api/image?code=${code}`);

  // Answer during 2s prep countdown is rejected with 409
  now += 1_000;
  assert.equal((await post(api, { action: 'answer', code, token: hostToken, answer: 'pikachu' })).status, 409);

  // After prep + 5s (25s left -> base 150 + 35 speed bonus = 185)
  now += 6_000;
  assert.equal((await post(api, { action: 'answer', code, token: hostToken, answer: 'pikachu' })).status, 200);
  assert.equal((await post(api, { action: 'answer', code, token: anaToken, answer: 'nope' })).status, 200);
  const revealed = await (await get(hostToken)).json();
  assert.equal(revealed.phase, 'reveal');
  assert.equal(revealed.answer, 'pikachu');
  assert.equal(revealed.answerOutcome, 'exact');
  assert.equal(revealed.pointsEarned, 185);
  assert.equal(revealed.speedBonus, 35);
  assert.equal(revealed.fastestPlayer.name, 'Gabriel');
  assert.deepEqual(revealed.players, [
    { name: 'Gabriel', score: 185, answered: true, lastRoundPoints: 185, speedRank: 1, reactionMs: 5_000 },
    { name: 'Ana', score: 0, answered: true, lastRoundPoints: 0, speedRank: 0, reactionMs: null },
  ]);
  assert.equal((await api.fetch(new Request('https://example.com/api/room', { method: 'PUT' }))).status, 405);
});

test('room API awards proximity points and 2nd-place speed bonus without leaking name before reveal', async () => {
  const redis = new RedisFake();
  let now = 2_000_000;
  const fetcher = async url => ({ ok: true, json: async () => ({
    id: Number(url.split('/').at(-1)), name: 'charizard', height: 17, weight: 905,
    types: [{ type: { name: 'fire' } }],
    sprites: { other: { 'official-artwork': { front_default: 'https://example.com/charizard.png' } } },
  }) });
  const api = createRoomApi({ getRedis: () => redis, fetcher, now: () => now, pick: () => 0 });
  const { code, token: hostToken } = await (await post(api, { action: 'create', name: 'Gabriel', generation: 1 })).json();
  const { token: anaToken } = await (await post(api, { action: 'join', code, name: 'Ana' })).json();
  await post(api, { action: 'start', code, token: hostToken });
  now += 2_000; // prep ends
  // Host answers with close typo 'charisard' first (30s left -> base 160 -> 70% = 112, +35 speed = 147)
  const hostAfter = await (await post(api, { action: 'answer', code, token: hostToken, answer: 'charisard' })).json();
  assert.equal(hostAfter.phase, 'question');
  assert.equal(hostAfter.answer, undefined);
  assert.equal(hostAfter.answerOutcome, 'proximity');
  assert.equal(hostAfter.pointsEarned, 147);
  assert.equal(JSON.stringify(hostAfter).includes('charizard'), false);

  // Ana answers exact second (30s left -> base 160 + 15 speed = 175)
  now += 1_000;
  const revealed = await (await post(api, { action: 'answer', code, token: anaToken, answer: 'charizard' })).json();
  assert.equal(revealed.phase, 'reveal');
  assert.equal(revealed.answer, 'charizard');
  assert.equal(revealed.answerOutcome, 'exact');
  assert.equal(revealed.speedBonus, 15);
  assert.equal(revealed.fastestPlayer.name, 'Gabriel');
});

test('image API proxies a black silhouette during question and original art during reveal', async () => {
  const redis = new RedisFake();
  let now = 1_000_000;
  const original = await sharp(Buffer.from([255, 0, 0, 255]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
  const pokemonFetcher = async url => ({ ok: true, json: async () => ({
    id: Number(url.split('/').at(-1)), name: 'pikachu', height: 4, weight: 60,
    types: [{ type: { name: 'electric' } }],
    sprites: { other: { 'official-artwork': { front_default: 'https://example.com/pikachu.png' } } },
  }) });
  const api = createRoomApi({ getRedis: () => redis, fetcher: pokemonFetcher, now: () => now, pick: () => 0 });
  const { code, token } = await (await post(api, { action: 'create', name: 'Gabriel' })).json();
  const { token: second } = await (await post(api, { action: 'join', code, name: 'Ana' })).json();
  await post(api, { action: 'start', code, token });
  const images = createImageApi({ getRedis: () => redis, fetcher: async () => ({
    ok: true, headers: new Headers({ 'content-type': 'image/png', 'content-length': String(original.length) }),
    arrayBuffer: async () => original,
  }), now: () => now });
  const get = playerToken => images.fetch(new Request(`https://example.com/api/image?code=${code}`, { headers: { 'x-player-token': playerToken } }));
  assert.equal((await get('wrong')).status, 401);
  const hidden = await get(token);
  assert.equal(hidden.headers.get('cache-control'), 'no-store');
  assert.equal(hidden.headers.get('location'), null);
  assert.deepEqual([...await sharp(await hidden.arrayBuffer()).raw().toBuffer()].slice(0, 3), [0, 0, 0]);
  now += 2_000;
  await post(api, { action: 'answer', code, token, answer: 'pikachu' });
  await post(api, { action: 'answer', code, token: second, answer: 'wrong' });
  const revealed = await get(token);
  assert.deepEqual([...await sharp(await revealed.arrayBuffer()).raw().toBuffer()].slice(0, 3), [255, 0, 0]);
  assert.equal((await images.fetch(new Request('https://example.com/api/image', { method: 'POST' }))).status, 405);
});

test('read and image request budgets also bind random tokens from the same IP', async () => {
  const redis = new RedisFake();
  const room = createRoomApi({ getRedis: () => redis });
  const image = createImageApi({ getRedis: () => redis });
  const makeRequest = (path, token) => new Request(`https://example.com${path}`, {
    headers: { 'x-player-token': token, 'x-vercel-forwarded-for': '203.0.113.10' },
  });
  for (let i = 0; i < 360; i++) {
    const response = await room.fetch(makeRequest('/api/room?code=ABC234', String(i).padStart(32, 'A')));
    assert.equal(response.status, 404);
  }
  assert.equal((await room.fetch(makeRequest('/api/room?code=ABC234', 'Z'.repeat(32)))).status, 429);
  for (let i = 0; i < 120; i++) {
    const response = await image.fetch(makeRequest('/api/image?code=ABC234', String(i).padStart(32, 'B')));
    assert.equal(response.status, 404);
  }
  assert.equal((await image.fetch(makeRequest('/api/image?code=ABC234', 'Y'.repeat(32)))).status, 429);
});

test('POST actions cannot bypass the IP budget by rotating player tokens', async () => {
  const redis = new RedisFake();
  const room = createRoomApi({ getRedis: () => redis });
  for (let i = 0; i < 120; i++) {
    const response = await post(room, { action: 'answer', code: 'ABC234', token: String(i).padStart(32, 'A'), answer: 'pikachu' });
    assert.equal(response.status, 404);
  }
  assert.equal((await post(room, { action: 'answer', code: 'ABC234', token: 'Z'.repeat(32), answer: 'pikachu' })).status, 429);
});
