import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREP_MS,
  QUESTION_MS,
  REVEAL_MS,
  createRoom,
  joinRoom,
  startRoom,
  answerRoom,
  hintRoom,
  advanceRoom,
  viewRoom,
  generationRange,
  chooseIds,
  classifyGuess,
} from '../lib/game.mjs';

const now = 1_000_000;
const questions = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  name: index === 0 ? 'pikachu' : index === 1 ? 'charizard' : index === 2 ? 'bulbasaur' : index === 3 ? 'mew' : `pokemon-${index + 1}`,
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
  assert.equal(room.prepEndsAt, now + PREP_MS);
  assert.equal(room.phaseEndsAt, now + PREP_MS + QUESTION_MS);
});

test('2-second prep lock blocks answers and hints until countdown completes', () => {
  const room = readyRoom();
  assert.equal(viewRoom(room, 'host-hash', now).prepRemainingMs, 2_000);
  assert.equal(viewRoom(room, 'host-hash', now + 1_000).remainingMs, 30_000);
  assert.throws(() => answerRoom(room, 'host-hash', 'pikachu', now + 1_999), /prepare-se/i);
  assert.throws(() => hintRoom(room, 'host-hash', now + 1_500), /prepare-se/i);
  hintRoom(room, 'host-hash', now + PREP_MS);
  answerRoom(room, 'host-hash', 'pikachu', now + PREP_MS);
  assert.equal(room.players[0].answeredRound, 1);
});

test('answer awards time, hint, and speed bonus once, then reveals when everyone answered', () => {
  const room = readyRoom();
  hintRoom(room, 'host-hash', now + 4_000);
  answerRoom(room, 'host-hash', '  PIKACHU  ', now + 5_000);
  // phaseEndsAt = now + 32_000 -> 27s remaining -> 100 + 27*2 - 25 = 129 base + 35 (1st speed bonus) = 164
  assert.equal(room.players[0].score, 164);
  assert.equal(room.players[0].lastRoundSpeedBonus, 35);
  assert.throws(() => answerRoom(room, 'host-hash', 'pikachu', now + 6_000), /palpite/i);
  answerRoom(room, 'ana-hash', 'errado', now + 7_000);
  assert.equal(room.players[1].score, 0);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.phaseEndsAt, now + 7_000 + REVEAL_MS);
  const revealed = viewRoom(room, 'host-hash', now + 7_000);
  assert.equal(revealed.answerOutcome, 'exact');
  assert.equal(revealed.pointsEarned, 164);
  assert.equal(revealed.speedBonus, 35);
  assert.equal(revealed.fastestPlayer.name, 'Gabriel');
});

test('fuzzy word proximity scoring rewards close typos and avoids short-word false positives', () => {
  assert.equal(classifyGuess('charisard', 'charizard').outcome, 'proximity');
  assert.equal(classifyGuess('bulbassauro', 'bulbasaur').outcome, 'proximity');
  assert.equal(classifyGuess('onyx', 'onix').outcome, 'proximity');
  assert.equal(classifyGuess('evee', 'eevee').outcome, 'proximity');
  assert.equal(classifyGuess('mewtwo', 'mew').outcome, 'wrong');
  assert.equal(classifyGuess('muk', 'mew').outcome, 'wrong');
  assert.equal(classifyGuess('pidgey', 'pidgeotto').outcome, 'wrong');
  assert.equal(classifyGuess('abra', 'kadabra').outcome, 'wrong');

  const room = readyRoom();
  // Round 2 is 'charizard'
  advanceRoom(room, now + PREP_MS + QUESTION_MS + REVEAL_MS);
  const r2Start = room.prepEndsAt;
  answerRoom(room, 'host-hash', 'charisard', r2Start + 5_000);
  // 25s remaining => base 150, 70% = 105, +35 speed bonus = 140
  assert.equal(room.players[0].lastRoundOutcome, 'proximity');
  assert.equal(room.players[0].score, 140);
  const hostView = viewRoom(room, 'host-hash', r2Start + 5_000);
  assert.equal(hostView.answerOutcome, 'proximity');
  assert.equal(hostView.pointsEarned, 105 + 35);
  assert.equal(hostView.answer, undefined);
  assert.equal(JSON.stringify(hostView).includes('charizard'), false);
});

test('duel speed bonus awards +35 to 1st, +15 to 2nd, and 0 to 3rd solver', () => {
  const room = createRoom('ABC234', 'Gabriel', 'host-hash', 'all', now);
  joinRoom(room, 'Ana', 'ana-hash');
  joinRoom(room, 'Lucas', 'lucas-hash');
  joinRoom(room, 'Bia', 'bia-hash');
  startRoom(room, 'host-hash', questions, now);

  const open = now + PREP_MS;
  answerRoom(room, 'bia-hash', 'wrong-guess', open + 1_000);
  answerRoom(room, 'ana-hash', 'pikachu', open + 2_000);
  answerRoom(room, 'lucas-hash', 'pikachu', open + 4_000);
  answerRoom(room, 'host-hash', 'pikachu', open + 6_000);

  const ana = room.players.find(p => p.name === 'Ana');
  const lucas = room.players.find(p => p.name === 'Lucas');
  const gabriel = room.players.find(p => p.name === 'Gabriel');
  const bia = room.players.find(p => p.name === 'Bia');

  assert.equal(ana.speedRank, 1);
  assert.equal(ana.lastRoundSpeedBonus, 35);
  assert.equal(lucas.speedRank, 2);
  assert.equal(lucas.lastRoundSpeedBonus, 15);
  assert.equal(gabriel.speedRank, 3);
  assert.equal(gabriel.lastRoundSpeedBonus, 0);
  assert.equal(bia.speedRank, 0);
  assert.equal(bia.lastRoundSpeedBonus, 0);
});

test('hints are private, capped at two, and answer stays hidden until reveal', () => {
  const room = readyRoom();
  const open = now + PREP_MS;
  hintRoom(room, 'host-hash', open);
  hintRoom(room, 'host-hash', open);
  assert.throws(() => hintRoom(room, 'host-hash', open), /duas dicas/i);
  const host = viewRoom(room, 'host-hash', open);
  const ana = viewRoom(room, 'ana-hash', open);
  assert.deepEqual(host.hints, questions[0].hints);
  assert.deepEqual(ana.hints, []);
  assert.equal(host.answer, undefined);
  assert.equal(JSON.stringify(host).includes('pikachu'), false);
  assert.equal(host.imageUrl, '/api/image?code=ABC234');
  advanceRoom(room, open + QUESTION_MS);
  assert.equal(viewRoom(room, 'host-hash', open + QUESTION_MS).answer, 'pikachu');
});

test('clock moves through ten 2s-prep + 30s-question and 5s-reveal rounds', () => {
  const room = readyRoom();
  const roundLen = PREP_MS + QUESTION_MS + REVEAL_MS;
  advanceRoom(room, now + roundLen);
  assert.equal(room.round, 2);
  assert.equal(room.phase, 'question');
  assert.equal(room.prepEndsAt, now + roundLen + PREP_MS);
  assert.equal(room.phaseEndsAt, now + roundLen + PREP_MS + QUESTION_MS);
  advanceRoom(room, now + 10 * roundLen);
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
