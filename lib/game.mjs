import { randomInt } from 'node:crypto';

export const PREP_MS = 2_000;
export const QUESTION_MS = 30_000;
export const REVEAL_MS = 5_000;
export const SPEED_BONUSES = [35, 15];

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

function freshPlayer(name, tokenHash) {
  return {
    name,
    tokenHash,
    score: 0,
    answeredRound: 0,
    hintsUsed: 0,
    lastRoundPoints: 0,
    lastRoundOutcome: null,
    lastRoundSpeedBonus: 0,
    speedRank: 0,
    reactionMs: null,
  };
}

function resetRoundPlayers(room) {
  for (const entry of room.players) {
    entry.answeredRound = 0;
    entry.hintsUsed = 0;
    entry.lastRoundPoints = 0;
    entry.lastRoundOutcome = null;
    entry.lastRoundSpeedBonus = 0;
    entry.speedRank = 0;
    entry.reactionMs = null;
  }
}

export function createRoom(code, name, tokenHash, generation = 'all', now = Date.now()) {
  generationRange(generation);
  return {
    code,
    generation,
    phase: 'lobby',
    round: 0,
    prepEndsAt: 0,
    phaseEndsAt: 0,
    hostTokenHash: tokenHash,
    players: [freshPlayer(validName(name), tokenHash)],
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
  room.players.push(freshPlayer(clean, tokenHash));
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
  room.prepEndsAt = now + PREP_MS;
  room.phaseEndsAt = room.prepEndsAt + QUESTION_MS;
  resetRoundPlayers(room);
  return room;
}

export function advanceRoom(room, now = Date.now()) {
  let changed = false;
  while ((room.phase === 'question' || room.phase === 'reveal') && now >= room.phaseEndsAt) {
    changed = true;
    if (room.phase === 'question') {
      room.phase = 'reveal';
      room.phaseEndsAt += REVEAL_MS;
    } else if (room.round < 10) {
      room.round++;
      room.phase = 'question';
      room.prepEndsAt = room.phaseEndsAt + PREP_MS;
      room.phaseEndsAt = room.prepEndsAt + QUESTION_MS;
      resetRoundPlayers(room);
    } else {
      room.phase = 'finished';
      room.prepEndsAt = 0;
      room.phaseEndsAt = 0;
    }
  }
  return changed;
}

export function normalizeAnswer(answer) {
  return String(answer).toLocaleLowerCase('en-US').replace(/♀/g, 'f').replace(/♂/g, 'm')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length >= b.length ? b : a;
  const cols = a.length >= b.length ? a : b;
  let prev = Array.from({ length: rows.length + 1 }, (_, index) => index);
  for (let col = 1; col <= cols.length; col++) {
    const curr = [col];
    for (let row = 1; row <= rows.length; row++) {
      const cost = cols[col - 1] === rows[row - 1] ? 0 : 1;
      curr[row] = Math.min(curr[row - 1] + 1, prev[row] + 1, prev[row - 1] + cost);
    }
    prev = curr;
  }
  return prev[rows.length];
}

export function classifyGuess(guess, target) {
  const a = normalizeAnswer(guess);
  const b = normalizeAnswer(target);
  if (!a || !b) return { outcome: 'wrong', similarity: 0 };
  if (a === b) return { outcome: 'exact', similarity: 1 };
  if (a.length < 3) return { outcome: 'wrong', similarity: 0 };
  const maxLen = Math.max(a.length, b.length);
  const distance = levenshteinDistance(a, b);
  const similarity = 1 - distance / maxLen;
  if (maxLen <= 3) return { outcome: 'wrong', similarity };
  if (maxLen <= 5) return { outcome: distance === 1 ? 'proximity' : 'wrong', similarity };
  return { outcome: similarity >= 0.72 ? 'proximity' : 'wrong', similarity };
}

export function roundScore(remainingMs, hintsUsed) {
  return Math.max(50, 100 + Math.floor(Math.max(0, remainingMs) / 1000) * 2 - hintsUsed * 25);
}

export function answerRoom(room, tokenHash, answer, now = Date.now()) {
  advanceRoom(room, now);
  const current = player(room, tokenHash);
  if (room.phase !== 'question') throw new GameError('Tempo de palpite encerrado.', 409);
  if (now < (room.prepEndsAt ?? 0)) throw new GameError('Prepare-se! Aguarde a contagem terminar.', 409);
  if (current.answeredRound === room.round) throw new GameError('Você já enviou um palpite nesta rodada.', 409);
  if (typeof answer !== 'string' || answer.trim().length < 1 || answer.length > 40) {
    throw new GameError('Palpite inválido.');
  }
  current.answeredRound = room.round;
  const { outcome } = classifyGuess(answer, room.questions[room.round - 1].name);
  current.lastRoundOutcome = outcome;
  if (outcome === 'exact' || outcome === 'proximity') {
    const basePoints = roundScore(Math.max(0, room.phaseEndsAt - now), current.hintsUsed);
    const guessPoints = outcome === 'exact' ? basePoints : Math.max(30, Math.round(basePoints * 0.7));
    current.reactionMs = Math.max(0, now - (room.prepEndsAt ?? now));
    current.lastRoundPoints = guessPoints;
    current.score += guessPoints;
    room.players.filter(entry => entry.reactionMs !== null)
      .sort((a, b) => a.reactionMs - b.reactionMs || a.tokenHash.localeCompare(b.tokenHash))
      .forEach((entry, index) => {
        const bonus = SPEED_BONUSES[index] ?? 0;
        const difference = bonus - entry.lastRoundSpeedBonus;
        entry.speedRank = index + 1;
        entry.lastRoundSpeedBonus = bonus;
        entry.lastRoundPoints += difference;
        entry.score += difference;
      });
  } else {
    current.lastRoundSpeedBonus = 0;
    current.speedRank = 0;
    current.reactionMs = null;
    current.lastRoundPoints = 0;
  }
  if (room.players.every(entry => entry.answeredRound === room.round)) {
    room.phase = 'reveal';
    room.phaseEndsAt = now + REVEAL_MS;
  }
  return room;
}

export function hintRoom(room, tokenHash, now = Date.now()) {
  advanceRoom(room, now);
  const current = player(room, tokenHash);
  if (room.phase !== 'question') throw new GameError('As dicas desta rodada encerraram.', 409);
  if (now < (room.prepEndsAt ?? 0)) throw new GameError('Prepare-se! Aguarde a contagem terminar.', 409);
  if (current.answeredRound === room.round) throw new GameError('Você já enviou seu palpite.', 409);
  if (current.hintsUsed >= 2) throw new GameError('Você já usou as duas dicas.', 409);
  current.hintsUsed++;
  return room;
}

export function viewRoom(room, tokenHash, now = Date.now()) {
  const current = player(room, tokenHash);
  const question = room.questions[room.round - 1];
  const prepRemainingMs = room.phase === 'question' && room.prepEndsAt ? Math.max(0, room.prepEndsAt - now) : 0;
  const activeClockRef = room.phase === 'question' && room.prepEndsAt ? Math.max(now, room.prepEndsAt) : now;
  const answeredThisRound = current.answeredRound === room.round && room.round > 0;
  const state = {
    code: room.code,
    phase: room.phase,
    round: room.round,
    totalRounds: 10,
    prepRemainingMs,
    remainingMs: room.phaseEndsAt ? Math.max(0, room.phaseEndsAt - activeClockRef) : 0,
    players: room.players.map(entry => ({
      name: entry.name,
      score: entry.score,
      answered: entry.answeredRound === room.round && room.round > 0,
      lastRoundPoints: entry.lastRoundPoints ?? 0,
      speedRank: entry.speedRank ?? 0,
      reactionMs: entry.reactionMs ?? null,
    })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    isHost: current.tokenHash === room.hostTokenHash,
    answered: answeredThisRound,
    answerOutcome: answeredThisRound ? (current.lastRoundOutcome ?? null) : null,
    pointsEarned: answeredThisRound ? (current.lastRoundPoints ?? 0) : 0,
    speedBonus: answeredThisRound ? (current.lastRoundSpeedBonus ?? 0) : 0,
    hintsUsed: current.hintsUsed,
    hints: question?.hints.slice(0, current.hintsUsed) ?? [],
    imageUrl: question ? `/api/image?code=${room.code}` : null,
  };
  if (question && (room.phase === 'reveal' || room.phase === 'finished')) {
    state.answer = question.name;
    const fastest = room.players.find(entry => entry.speedRank === 1);
    if (fastest) {
      state.fastestPlayer = {
        name: fastest.name,
        points: fastest.lastRoundPoints ?? 0,
        bonus: fastest.lastRoundSpeedBonus ?? 0,
        reactionMs: fastest.reactionMs ?? 0,
      };
    }
  }
  return state;
}
