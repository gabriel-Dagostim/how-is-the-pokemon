import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoredRoom, updateStoredRoom, rateLimit } from '../lib/store.mjs';

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

test('room creation refuses a colliding code and updates keep both simultaneous scores', async () => {
  const redis = new RedisFake();
  const room = { code: 'ABC234', version: 1, score: 0 };
  assert.equal(await createStoredRoom(redis, room), true);
  assert.equal(await createStoredRoom(redis, room), false);
  await Promise.all([
    updateStoredRoom(redis, room.code, async current => { await new Promise(resolve => setTimeout(resolve, 5)); current.score++; return true; }),
    updateStoredRoom(redis, room.code, async current => { current.score++; return true; }),
  ]);
  assert.equal((await redis.get('pokemon:room:ABC234')).score, 2);
});

test('missing room and exhausted request budget return explicit errors', async () => {
  const redis = new RedisFake();
  await assert.rejects(updateStoredRoom(redis, 'ABC234', () => true), error => error.status === 404);
  await rateLimit(redis, 'create:ip', 2, 60);
  await rateLimit(redis, 'create:ip', 2, 60);
  await assert.rejects(rateLimit(redis, 'create:ip', 2, 60), error => error.status === 429);
});
