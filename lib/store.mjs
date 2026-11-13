import { GameError } from './game.mjs';

const ROOM_TTL = 7_200;
const CAS = `
  local current = redis.call('GET', KEYS[1])
  if not current then return -1 end
  if cjson.decode(current).version ~= tonumber(ARGV[1]) then return 0 end
  redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
  return 1
`;
const COUNT = `
  local hits = redis.call('INCR', KEYS[1])
  if hits == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
  return hits
`;

const roomKey = code => `pokemon:room:${code}`;

export async function createStoredRoom(redis, room) {
  return await redis.set(roomKey(room.code), room, { nx: true, ex: ROOM_TTL }) === 'OK';
}

export async function updateStoredRoom(redis, code, change) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const room = await redis.get(roomKey(code));
    if (!room) throw new GameError('Sala não encontrada ou expirada.', 404);
    const version = room.version;
    if (!await change(room)) return room;
    room.version = version + 1;
    const saved = await redis.eval(CAS, [roomKey(code)], [version, JSON.stringify(room), ROOM_TTL]);
    if (saved === 1) return room;
    if (saved === -1) throw new GameError('Sala não encontrada ou expirada.', 404);
  }
  throw new GameError('Sala ocupada. Tente novamente.', 503);
}

export async function rateLimit(redis, key, max, seconds) {
  const hits = await redis.eval(COUNT, [`pokemon:rate:${key}`], [seconds]);
  if (hits > max) throw new GameError('Muitas tentativas. Aguarde um pouco.', 429);
}
