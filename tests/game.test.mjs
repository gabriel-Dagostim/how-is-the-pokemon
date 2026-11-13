import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom,
  joinRoom,
  startRoom,
  answerRoom,
  hintRoom,
  advanceRoom,
  viewRoom,
  generationRange,
  chooseIds,
} from '../lib/game.mjs';

const now = 1_000_000;
const questions = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  name: index === 0 ? 'pikachu' : `pokemon-${index + 1}`,
  hints: ['Tipo: elétrico', 'Altura: 0,4 m · Peso: 6 kg'],
}));

function readyRoom() {
  const room = createRoom('ABC234', 'Gabriel', 'host-hash', 'all', now);
  joinRoom(room, 'Ana', 'ana-hash');
  startRoom(room, 'host-hash', questions, now);
  return room;
}

test('lobby accepts two to eight distinct names and only its host can start', () => {
  const room = createRoom('ABC234', ' Gabriel ', 'host-hash', 1, now);
  assert.equal(room.players[0].name, 'Gabriel');
  assert.throws(() => startRoom(room, 'host-hash', questions, now), /dois jogadores/i);
  joinRoom(room, 'Ana', 'ana-hash');
  joinRoom(room, 'A', 'letter-hash');
  assert.equal(room.players[2].name, 'A');
  assert.throws(() => joinRoom(room, 'ana', 'other-hash'), /nome.*uso/i);
  assert.throws(() => startRoom(room, 'ana-hash', questions, now), /anfitrião/i);
  for (let i = 4; i <= 8; i++) joinRoom(room, `Jogador ${i}`, `hash-${i}`);
  assert.throws(() => joinRoom(room, 'Nono', 'hash-9'), /lotada/i);
  startRoom(room, 'host-hash', questions, now);
  assert.equal(room.phase, 'question');
  assert.equal(room.phaseEndsAt, now + 30_000);
});

test('answer awards time and hint adjusted points once, then reveals when everyone answered', () => {
  const room = readyRoom();
  hintRoom(room, 'host-hash', now + 4_000);
  answerRoom(room, 'host-hash', '  PIKACHU  ', now + 5_000);
  assert.equal(room.players[0].score, 125);
  assert.throws(() => answerRoom(room, 'host-hash', 'pikachu', now + 6_000), /palpite/i);
  answerRoom(room, 'ana-hash', 'errado', now + 7_000);
  assert.equal(room.players[1].score, 0);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.phaseEndsAt, now + 12_000);
});

test('hints are private, capped at two, and answer stays hidden until reveal', () => {
  const room = readyRoom();
  hintRoom(room, 'host-hash', now);
  hintRoom(room, 'host-hash', now);
  assert.throws(() => hintRoom(room, 'host-hash', now), /duas dicas/i);
  const host = viewRoom(room, 'host-hash', now);
  const ana = viewRoom(room, 'ana-hash', now);
  assert.deepEqual(host.hints, questions[0].hints);
  assert.deepEqual(ana.hints, []);
  assert.equal(host.answer, undefined);
  assert.equal(JSON.stringify(host).includes('pikachu'), false);
  assert.equal(host.imageUrl, '/api/image?code=ABC234');
  advanceRoom(room, now + 30_000);
  assert.equal(viewRoom(room, 'host-hash', now + 30_000).answer, 'pikachu');
});

test('clock moves through ten 30 second questions and 5 second reveals', () => {
  const room = readyRoom();
  advanceRoom(room, now + 35_000);
  assert.equal(room.round, 2);
  assert.equal(room.phase, 'question');
  assert.equal(room.phaseEndsAt, now + 65_000);
  advanceRoom(room, now + 350_000);
  assert.equal(room.phase, 'finished');
  assert.equal(room.round, 10);
});

test('generation selection covers each Pokédex ID from 1 to 1025 without overlaps', () => {
  const ranges = Array.from({ length: 9 }, (_, i) => generationRange(i + 1));
  assert.deepEqual(ranges[0], [1, 151]);
  assert.deepEqual(ranges[7], [810, 905]);
  assert.deepEqual(ranges[8], [906, 1025]);
  assert.deepEqual(generationRange('all'), [1, 1025]);
  for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i][0], ranges[i - 1][1] + 1);
  assert.throws(() => generationRange(10), /geração/i);
  const ids = chooseIds([1, 151], 10, () => 0);
  assert.equal(new Set(ids).size, 10);
  assert.ok(ids.every(id => id >= 1 && id <= 151));
});
