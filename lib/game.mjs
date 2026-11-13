import { randomInt } from 'node:crypto';

const RANGES = [[1, 151], [152, 251], [252, 386], [387, 493], [494, 649], [650, 721], [722, 809], [810, 905], [906, 1025]];

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function generationRange(generation = 'all') {
  if (generation === 'all') return [1, 1025];
  const value = Number(generation);
  if (!Number.isInteger(value) || value < 1 || value > 9) throw new GameError('Geração inválida.');
  return RANGES[value - 1];
}

export function chooseIds([first, last], count, pick = randomInt) {
  const ids = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  if (count > ids.length) throw new GameError('Geração sem Pokémon suficientes.');
  for (let index = 0; index < count; index++) {
    const swap = index + pick(ids.length - index);
    [ids[index], ids[swap]] = [ids[swap], ids[index]];
  }
  return ids.slice(0, count);
}

function validName(name) {
  const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (clean.length < 1 || clean.length > 24 || !/^[\p{L}\p{N} _-]+$/u.test(clean)) {
    throw new GameError('Nome deve ter de 1 a 24 caracteres, sem símbolos.');
  }
  return clean;
}

export function createRoom(code, name, tokenHash, generation = 'all', now = Date.now()) {
  generationRange(generation);
  return {
    code,
    generation,
    phase: 'lobby',
    round: 0,
    phaseEndsAt: 0,
    hostTokenHash: tokenHash,
    players: [{ name: validName(name), tokenHash, score: 0, answeredRound: 0, hintsUsed: 0 }],
    questions: [],
    createdAt: now,
    version: 1,
  };
}

function player(room, tokenHash) {
  const found = room.players.find(entry => entry.tokenHash === tokenHash);
  if (!found) throw new GameError('Jogador não encontrado nesta sala.', 401);
  return found;
}

export function joinRoom(room, name, tokenHash) {
  const clean = validName(name);
  if (room.phase !== 'lobby') throw new GameError('A partida já começou.', 409);
  if (room.players.length >= 8) throw new GameError('Sala lotada.', 409);
  if (room.players.some(entry => entry.name.toLocaleLowerCase('pt-BR') === clean.toLocaleLowerCase('pt-BR'))) {
    throw new GameError('Nome já em uso na sala.', 409);
  }
  room.players.push({ name: clean, tokenHash, score: 0, answeredRound: 0, hintsUsed: 0 });
  return room;
}

export function assertCanStart(room, tokenHash) {
  player(room, tokenHash);
  if (room.hostTokenHash !== tokenHash) throw new GameError('Só o anfitrião pode iniciar.', 403);
  if (room.phase !== 'lobby') throw new GameError('A partida já começou.', 409);
  if (room.players.length < 2) throw new GameError('São necessários dois jogadores.', 409);
}

export function startRoom(room, tokenHash, questions, now = Date.now()) {
  assertCanStart(room, tokenHash);
  if (!Array.isArray(questions) || questions.length !== 10) throw new GameError('Não foi possível preparar dez rodadas.', 502);
  room.questions = questions;
  room.phase = 'question';
  room.round = 1;
  room.phaseEndsAt = now + 30_000;
  return room;
}

export function advanceRoom(room, now = Date.now()) {
  let changed = false;
  while ((room.phase === 'question' || room.phase === 'reveal') && now >= room.phaseEndsAt) {
    changed = true;
    if (room.phase === 'question') {
      room.phase = 'reveal';
      room.phaseEndsAt += 5_000;
    } else if (room.round < 10) {
      room.round++;
      room.phase = 'question';
      room.phaseEndsAt += 30_000;
      for (const entry of room.players) {
        entry.answeredRound = 0;
        entry.hintsUsed = 0;
      }
    } else {
      room.phase = 'finished';
      room.phaseEndsAt = 0;
    }
  }
  return changed;
}

function normalizeAnswer(answer) {
  return answer.toLocaleLowerCase('en-US').replace(/♀/g, 'f').replace(/♂/g, 'm')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

export function answerRoom(room, tokenHash, answer, now = Date.now()) {
  advanceRoom(room, now);
  const current = player(room, tokenHash);
  if (room.phase !== 'question') throw new GameError('Tempo de palpite encerrado.', 409);
  if (current.answeredRound === room.round) throw new GameError('Você já enviou um palpite nesta rodada.', 409);
  if (typeof answer !== 'string' || answer.trim().length < 1 || answer.length > 40) {
    throw new GameError('Palpite inválido.');
  }
  current.answeredRound = room.round;
  if (normalizeAnswer(answer) === normalizeAnswer(room.questions[room.round - 1].name)) {
    current.score += Math.max(50, 100 + Math.floor((room.phaseEndsAt - now) / 1000) * 2 - current.hintsUsed * 25);
  }
  if (room.players.every(entry => entry.answeredRound === room.round)) {
    room.phase = 'reveal';
    room.phaseEndsAt = now + 5_000;
  }
  return room;
}

export function hintRoom(room, tokenHash, now = Date.now()) {
  advanceRoom(room, now);
  const current = player(room, tokenHash);
  if (room.phase !== 'question') throw new GameError('As dicas desta rodada encerraram.', 409);
  if (current.answeredRound === room.round) throw new GameError('Você já enviou seu palpite.', 409);
  if (current.hintsUsed >= 2) throw new GameError('Você já usou as duas dicas.', 409);
  current.hintsUsed++;
  return room;
}

export function viewRoom(room, tokenHash, now = Date.now()) {
  const current = player(room, tokenHash);
  const question = room.questions[room.round - 1];
  const state = {
    code: room.code,
    phase: room.phase,
    round: room.round,
    totalRounds: 10,
    remainingMs: room.phaseEndsAt ? Math.max(0, room.phaseEndsAt - now) : 0,
    players: room.players.map(({ name, score }) => ({ name, score })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    isHost: current.tokenHash === room.hostTokenHash,
    answered: current.answeredRound === room.round && room.round > 0,
    hintsUsed: current.hintsUsed,
    hints: question?.hints.slice(0, current.hintsUsed) ?? [],
    imageUrl: question ? `/api/image?code=${room.code}` : null,
  };
  if (question && (room.phase === 'reveal' || room.phase === 'finished')) state.answer = question.name;
  return state;
}
