const TOTAL_ROUNDS = 10;
const PREP_MS = 2_000;
const QUESTION_MS = 30_000;
const REVEAL_MS = 5_000;
const TYPE_NAMES = {
  normal: 'Normal', fire: 'Fogo', water: 'Água', electric: 'Elétrico', grass: 'Planta', ice: 'Gelo',
  fighting: 'Lutador', poison: 'Venenoso', ground: 'Terra', flying: 'Voador', psychic: 'Psíquico',
  bug: 'Inseto', rock: 'Pedra', ghost: 'Fantasma', dragon: 'Dragão', dark: 'Sombrio', steel: 'Aço', fairy: 'Fada',
};

function normalizeAnswer(value) {
  return String(value).replace(/♀/g, 'f').replace(/♂/g, 'm').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshteinDistance(a, b) {
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

function classifyGuess(guess, target) {
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

function roundScore(remainingMs, hintsUsed) {
  return Math.max(50, 100 + Math.floor(Math.max(0, remainingMs) / 1000) * 2 - hintsUsed * 25);
}

function scoreGuess(guess, target, remainingMs, hintsUsed) {
  const { outcome, similarity } = classifyGuess(guess, target);
  if (outcome === 'wrong') return { outcome, similarity, points: 0 };
  const base = roundScore(remainingMs, hintsUsed);
  const points = outcome === 'exact' ? base : Math.max(30, Math.round(base * 0.7));
  return { outcome, similarity, points };
}

function formatClock(milliseconds) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `00:${String(seconds).padStart(2, '0')}`;
}

function displayPokemonName(name) {
  return String(name || '').replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function createSoundEngine() {
  let ctx = null;
  let muted = false;
  try {
    muted = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('arena-muted') === '1';
  } catch { muted = false; }

  function getContext() {
    if (muted || typeof window === 'undefined') return null;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (typeof AudioCtor !== 'function') return null;
    try {
      if (!ctx) ctx = new AudioCtor();
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(() => {});
      return ctx;
    } catch {
      return null;
    }
  }

  function tone(freq, duration, { type = 'sine', gain = 0.08, delay = 0, slideTo = null } = {}) {
    const audio = getContext();
    if (!audio) return;
    try {
      const start = audio.currentTime + delay;
      const osc = audio.createOscillator();
      const amp = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.linearRampToValueAtTime(gain, start + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(amp);
      amp.connect(audio.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    } catch {
      // Audio playback must never break gameplay
    }
  }

  const patterns = {
    click: () => tone(520, 0.045, { type: 'triangle', gain: 0.05, slideTo: 690 }),
    pokeball: () => {
      tone(320, 0.08, { type: 'triangle', gain: 0.07, slideTo: 540 });
      tone(660, 0.12, { type: 'sine', gain: 0.07, delay: 0.07 });
    },
    countdown2: () => tone(440, 0.09, { type: 'sine', gain: 0.06 }),
    countdown1: () => tone(523.25, 0.09, { type: 'sine', gain: 0.07 }),
    go: () => {
      tone(659.25, 0.08, { type: 'triangle', gain: 0.08 });
      tone(880, 0.16, { type: 'triangle', gain: 0.09, delay: 0.06 });
    },
    hint: () => {
      tone(783.99, 0.08, { type: 'sine', gain: 0.06 });
      tone(1046.5, 0.14, { type: 'sine', gain: 0.07, delay: 0.07 });
    },
    exact: () => {
      tone(523.25, 0.09, { type: 'triangle', gain: 0.08 });
      tone(659.25, 0.09, { type: 'triangle', gain: 0.08, delay: 0.08 });
      tone(783.99, 0.09, { type: 'triangle', gain: 0.09, delay: 0.16 });
      tone(1046.5, 0.24, { type: 'triangle', gain: 0.1, delay: 0.24 });
    },
    proximity: () => {
      tone(587.33, 0.1, { type: 'sine', gain: 0.07 });
      tone(880, 0.18, { type: 'sine', gain: 0.08, delay: 0.09 });
    },
    wrong: () => tone(210, 0.22, { type: 'sawtooth', gain: 0.05, slideTo: 135 }),
    reveal: () => {
      tone(392, 0.12, { type: 'sine', gain: 0.05, slideTo: 587.33 });
      tone(783.99, 0.16, { type: 'sine', gain: 0.05, delay: 0.08 });
    },
    victory: () => {
      [523.25, 659.25, 783.99, 659.25, 783.99, 1046.5].forEach((note, idx) => {
        tone(note, idx === 5 ? 0.34 : 0.1, { type: 'triangle', gain: 0.08, delay: idx * 0.1 });
      });
    },
  };

  return {
    isMuted: () => muted,
    setMuted(next) {
      muted = Boolean(next);
      try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('arena-muted', muted ? '1' : '0'); } catch {}
      if (!muted) patterns.click();
      return muted;
    },
    play(name) {
      if (!muted && patterns[name]) patterns[name]();
    },
  };
}

if (typeof window !== 'undefined') {
  const $ = id => document.getElementById(id);
  const ui = Object.fromEntries([
    'homeScreen', 'lobbyScreen', 'gameScreen', 'resultScreen', 'notice', 'playerName', 'generation', 'joinCode',
    'soloButton', 'createButton', 'joinButton', 'brandButton', 'muteButton', 'muteLabel',
    'lobbyBackButton', 'gameBackButton', 'resultBackButton',
    'modeBadge', 'roomBadge', 'headerRoomCode', 'roundBadge', 'headerRound',
    'lobbyCode', 'copyCodeButton', 'playerCount', 'lobbyPlayerList', 'startRoomButton', 'lobbyWaiting',
    'timerBox', 'timerText', 'yourScore', 'questionKicker', 'answerForm', 'answerInput', 'answerButton',
    'answerStatus', 'hintList', 'hintButton', 'revealCard', 'revealedName', 'revealMessage', 'fastestBadge',
    'pokemonImage', 'imagePlaceholder', 'prepOverlay', 'prepCount', 'prepText',
    'leaderboardList', 'leaderboardSub', 'resultTitle', 'resultSummary', 'resultList', 'newGameButton',
  ].map(id => [id, $(id)]));

  const sound = createSoundEngine();
  const genChips = typeof document.querySelectorAll === 'function' ? [...document.querySelectorAll('#generationChips .gen-chip')] : [];

  const state = {
    mode: 'home', name: '', generation: 'all', code: '', token: '', room: null, solo: null,
    session: 0, roomSeenAt: 0,
    pollTimer: null, clockTimer: null, noticeTimer: null, fetchingRoom: false, busy: false,
    imageKey: '', imageObjectUrl: '', roundKey: '', lastGuess: '',
    prepSoundKey: '', revealSoundKey: '', finishSoundSession: -1,
    pools: new Map(), usedIds: new Set(),
  };

  function syncMuteUi() {
    const muted = sound.isMuted();
    if (!ui.muteButton) return;
    ui.muteButton.classList.toggle('is-muted', muted);
    ui.muteButton.setAttribute('aria-pressed', muted ? 'true' : 'false');
    ui.muteButton.setAttribute('aria-label', muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros');
    if (ui.muteLabel) ui.muteLabel.textContent = muted ? 'Mudo' : 'Som';
    if (typeof ui.muteButton.querySelector === 'function') {
      const onIcon = ui.muteButton.querySelector('.sound-icon-on');
      const offIcon = ui.muteButton.querySelector('.sound-icon-off');
      if (onIcon) onIcon.hidden = muted;
      if (offIcon) offIcon.hidden = !muted;
    }
  }

  function syncGenerationChips(value) {
    for (const chip of genChips) {
      const active = chip.dataset?.gen === String(value);
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function showNotice(message, error = false) {
    ui.notice.textContent = message;
    ui.notice.classList.toggle('error', error);
    ui.notice.hidden = !message;
    clearTimeout(state.noticeTimer);
    if (message) state.noticeTimer = setTimeout(() => { ui.notice.hidden = true; }, 4500);
  }

  function showScreen(name) {
    for (const screen of ['homeScreen', 'lobbyScreen', 'gameScreen', 'resultScreen']) ui[screen].hidden = screen !== name;
    ui.modeBadge.hidden = name === 'homeScreen';
    ui.modeBadge.textContent = state.mode === 'room' ? 'Competição' : 'Solo';
    ui.roomBadge.hidden = state.mode !== 'room' || name === 'homeScreen';
    ui.roundBadge.hidden = name !== 'gameScreen';
  }

  function playerName() {
    const name = ui.playerName.value.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 24 || !/^[\p{L}\p{N} _-]+$/u.test(name)) {
      showNotice('Use um nome de 1 a 24 caracteres, com letras, números, espaço, _ ou -.', true);
      ui.playerName.focus();
      return '';
    }
    state.name = name;
    try { sessionStorage.setItem('arena-name', name); } catch {}
    return name;
  }

  function setBusy(busy) {
    state.busy = busy;
    for (const button of [ui.soloButton, ui.createButton, ui.joinButton]) button.disabled = busy;
  }

  function avatar(name) {
    const element = document.createElement('span');
    element.className = 'avatar';
    element.textContent = name.trim().charAt(0).toUpperCase() || '?';
    element.setAttribute('aria-hidden', 'true');
    return element;
  }

  function medalText(index) {
    if (index === 0) return '1º';
    if (index === 1) return '2º';
    if (index === 2) return '3º';
    return `${index + 1}º`;
  }

  function renderPlayers(target, players, ranked = false, { showLiveStatus = false } = {}) {
    target.replaceChildren();
    const ordered = ranked ? [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)) : players;
    const leaderScore = Math.max(1, ordered[0]?.score ?? 1);
    ordered.forEach((player, index) => {
      const li = document.createElement('li');
      if (!ranked) {
        li.append(avatar(player.name));
        const name = document.createElement('span');
        name.className = 'player-name';
        name.textContent = player.name;
        li.append(name);
        target.append(li);
        return;
      }

      if (index === 0 && player.score > 0) li.classList.add('rank-leader');
      if (player.name === state.name) li.classList.add('me');

      const rowMain = document.createElement('div');
      rowMain.className = 'player-row-main';

      const rank = document.createElement('span');
      rank.className = index < 3 ? `rank rank-${index + 1}` : 'rank';
      rank.textContent = medalText(index);

      const name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = player.name;

      const score = document.createElement('span');
      score.className = 'player-score';
      score.textContent = `${player.score} pts`;

      rowMain.append(rank, avatar(player.name), name, score);
      li.append(rowMain);

      const hasBadges = (showLiveStatus && player.answered) || (player.lastRoundPoints > 0) || (player.speedRank === 1 || player.speedRank === 2);
      if (hasBadges) {
        const badges = document.createElement('div');
        badges.className = 'player-badges';
        if (showLiveStatus && player.answered) {
          const done = document.createElement('span');
          done.className = 'badge-pill badge-answered';
          done.textContent = 'Respondeu ✓';
          badges.append(done);
        }
        if (player.speedRank === 1 || player.speedRank === 2) {
          const fast = document.createElement('span');
          fast.className = 'badge-pill badge-fastest';
          fast.textContent = player.speedRank === 1 ? '⚡ 1º Mais rápido' : '⚡ 2º Rápido';
          badges.append(fast);
        }
        if (player.lastRoundPoints > 0) {
          const delta = document.createElement('span');
          delta.className = 'badge-pill badge-delta';
          delta.textContent = `+${player.lastRoundPoints}`;
          badges.append(delta);
        }
        li.append(badges);
      }

      const progress = document.createElement('div');
      progress.className = 'player-progress';
      const fill = document.createElement('span');
      fill.className = 'player-progress-fill';
      const pct = player.score > 0 ? Math.max(8, Math.round((player.score / leaderScore) * 100)) : 0;
      if (fill.style) fill.style.width = `${pct}%`;
      progress.append(fill);
      li.append(progress);

      target.append(li);
    });
  }

  function renderClock(remainingMs) {
    ui.timerText.textContent = formatClock(remainingMs);
    ui.timerBox.classList.toggle('urgent', remainingMs <= 5_000);
  }

  function renderPrep(prepRemainingMs, roundKey) {
    if (!ui.prepOverlay) return;
    if (prepRemainingMs > 0) {
      const step = prepRemainingMs > 1_000 ? 2 : 1;
      ui.prepOverlay.hidden = false;
      if (ui.prepCount) ui.prepCount.textContent = String(step);
      if (ui.prepText) ui.prepText.textContent = 'Prepare-se…';
      ui.answerInput.disabled = true;
      ui.answerButton.disabled = true;
      ui.hintButton.disabled = true;
      const cueKey = `${roundKey}:${step}`;
      if (state.prepSoundKey !== cueKey) {
        state.prepSoundKey = cueKey;
        sound.play(step === 2 ? 'countdown2' : 'countdown1');
      }
      return;
    }
    const wasPrepping = !ui.prepOverlay.hidden;
    ui.prepOverlay.hidden = true;
    if (wasPrepping) {
      const goKey = `${roundKey}:go`;
      if (state.prepSoundKey !== goKey) {
        state.prepSoundKey = goKey;
        sound.play('go');
      }
    }
  }

  function clearImage() {
    if (state.imageObjectUrl) URL.revokeObjectURL(state.imageObjectUrl);
    state.imageObjectUrl = '';
    ui.pokemonImage.removeAttribute('src');
    ui.pokemonImage.hidden = true;
    ui.imagePlaceholder.hidden = false;
    state.imageKey = '';
  }

  function setImage(url, key) {
    clearImage();
    state.imageKey = key;
    ui.pokemonImage.onload = () => { ui.pokemonImage.hidden = false; ui.imagePlaceholder.hidden = true; };
    ui.pokemonImage.onerror = () => { ui.pokemonImage.hidden = true; ui.imagePlaceholder.hidden = false; };
    ui.pokemonImage.src = url;
  }

  async function loadRoomImage(key, imageUrl) {
    clearImage();
    state.imageKey = key;
    try {
      if (!imageUrl || !imageUrl.startsWith('/api/image?')) throw new Error('Imagem indisponível');
      const response = await fetch(imageUrl, { headers: { 'x-player-token': state.token } });
      if (!response.ok) throw new Error('Imagem indisponível');
      const url = URL.createObjectURL(await response.blob());
      if (state.imageKey !== key || state.mode !== 'room') { URL.revokeObjectURL(url); return; }
      state.imageObjectUrl = url;
      ui.pokemonImage.onload = () => { ui.pokemonImage.hidden = false; ui.imagePlaceholder.hidden = true; };
      ui.pokemonImage.onerror = () => { ui.pokemonImage.hidden = true; ui.imagePlaceholder.hidden = false; };
      ui.pokemonImage.src = url;
    } catch {
      if (state.imageKey === key) showNotice('Não foi possível carregar a silhueta. Tentaremos novamente na próxima rodada.', true);
    }
  }

  function renderHints(hints, used, enabled, prepLocked = false) {
    ui.hintList.replaceChildren();
    hints.forEach((hint, index) => {
      const li = document.createElement('li');
      const number = document.createElement('span');
      number.textContent = index + 1;
      li.append(number, document.createTextNode(hint));
      ui.hintList.append(li);
    });
    ui.hintButton.hidden = !enabled;
    ui.hintButton.disabled = prepLocked || used >= 2;
    ui.hintButton.textContent = used >= 2 ? 'Todas as dicas reveladas' : `Revelar dica ${used + 1}`;
  }

  function renderReveal(answer, message, fastestPlayer = null) {
    ui.revealCard.hidden = false;
    ui.revealedName.textContent = displayPokemonName(answer);
    ui.revealMessage.textContent = message;
    if (ui.fastestBadge) {
      if (fastestPlayer?.name) {
        const secs = ((fastestPlayer.reactionMs ?? 0) / 1000).toFixed(1).replace('.', ',');
        ui.fastestBadge.hidden = false;
        ui.fastestBadge.textContent = `⚡ Mais rápido: ${fastestPlayer.name} (+${fastestPlayer.bonus} pts bônus · ${secs}s)`;
      } else {
        ui.fastestBadge.hidden = true;
      }
    }
    ui.pokemonImage.classList.add('revealed');
    ui.pokemonImage.alt = `Pokémon revelado: ${displayPokemonName(answer)}`;
    ui.answerForm.hidden = true;
  }

  function renderQuestion(round, score, players, answered, hintsUsed, hints, { prepRemainingMs = 0, roundKey = '', showLiveStatus = false } = {}) {
    const wasHidden = ui.gameScreen.hidden;
    showScreen('gameScreen');
    ui.headerRound.textContent = `${round}/${TOTAL_ROUNDS}`;
    ui.questionKicker.textContent = `RODADA ${round} DE ${TOTAL_ROUNDS}`;
    ui.yourScore.textContent = score;
    ui.pokemonImage.classList.remove('revealed');
    ui.pokemonImage.alt = 'Silhueta de um Pokémon misterioso';
    ui.answerForm.hidden = false;
    const prepLocked = prepRemainingMs > 0;
    ui.answerInput.disabled = prepLocked || answered;
    ui.answerButton.disabled = prepLocked || answered;
    if (prepLocked) {
      ui.answerStatus.textContent = 'Prepare-se! A rodada vai começar…';
    } else if (answered) {
      ui.answerStatus.textContent = 'Resposta enviada. Aguardando a revelação.';
    } else {
      ui.answerStatus.textContent = '';
    }
    ui.revealCard.hidden = true;
    if (ui.fastestBadge) ui.fastestBadge.hidden = true;
    renderHints(hints, hintsUsed, !answered, prepLocked);
    renderPrep(prepRemainingMs, roundKey);
    renderPlayers(ui.leaderboardList, players, true, { showLiveStatus });
    ui.leaderboardSub.textContent = state.mode === 'room' ? 'ao vivo' : 'jogo solo';
    if (!prepLocked && !answered && wasHidden) ui.answerInput.focus({ preventScroll: true });
  }

  function renderResult(players) {
    showScreen('resultScreen');
    const ordered = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    ui.resultTitle.textContent = state.mode === 'solo' ? 'Sua partida terminou!' : 'A arena tem um vencedor!';
    ui.resultSummary.textContent = state.mode === 'solo'
      ? `Você fez ${ordered[0]?.score ?? 0} pontos em ${TOTAL_ROUNDS} rodadas.`
      : `${ordered[0]?.name || 'Treinador'} venceu com ${ordered[0]?.score ?? 0} pontos.`;
    renderPlayers(ui.resultList, players, true);
    if (state.finishSoundSession !== state.session) {
      state.finishSoundSession = state.session;
      sound.play('victory');
    }
  }

  function stopTimers() {
    clearInterval(state.pollTimer);
    clearInterval(state.clockTimer);
    state.pollTimer = null;
    state.clockTimer = null;
  }

  function goHome() {
    state.session++;
    stopTimers();
    clearImage();
    setBusy(false);
    state.fetchingRoom = false;
    state.mode = 'home';
    state.code = '';
    state.token = '';
    state.room = null;
    state.solo = null;
    state.roundKey = '';
    state.lastGuess = '';
    state.prepSoundKey = '';
    state.revealSoundKey = '';
    if (ui.prepOverlay) ui.prepOverlay.hidden = true;
    try {
      sessionStorage.removeItem('arena-room');
      sessionStorage.removeItem('arena-token');
    } catch {}
    showScreen('homeScreen');
  }

  async function roomRequest(method, action, extra = {}) {
    const url = method === 'GET' ? `/api/room?code=${encodeURIComponent(state.code)}` : '/api/room';
    const response = await fetch(url, {
      method,
      headers: { ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...(state.token ? { 'x-player-token': state.token } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify({ action, code: state.code || undefined, token: state.token || undefined, ...extra }) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || data.message || 'Não foi possível falar com a sala.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function fetchRoom() {
    if (state.fetchingRoom || state.mode !== 'room') return;
    const session = state.session;
    state.fetchingRoom = true;
    try {
      const room = await roomRequest('GET');
      if (state.mode !== 'room' || state.session !== session) return;
      state.room = room;
      state.roomSeenAt = Date.now();
      renderRoom(room);
    } catch (error) {
      if (state.session !== session) return;
      if ([401, 403, 404].includes(error.status)) goHome();
      showNotice(error.message, true);
    } finally { if (state.session === session) state.fetchingRoom = false; }
  }

  function tickRoomClock() {
    const room = state.room;
    if (!room || (room.phase !== 'question' && room.phase !== 'reveal')) return;
    const elapsed = Date.now() - state.roomSeenAt;
    if (room.phase === 'reveal') {
      renderClock(room.remainingMs - elapsed);
      return;
    }
    const prepTotal = room.prepRemainingMs ?? 0;
    const prepLeft = Math.max(0, prepTotal - elapsed);
    const roundKey = `${room.code}:${room.round}`;
    const wasPrepping = ui.prepOverlay && !ui.prepOverlay.hidden;
    renderPrep(prepLeft, roundKey);
    if (prepLeft === 0 && wasPrepping && !room.answered && !state.busy) {
      ui.answerInput.disabled = false;
      ui.answerButton.disabled = false;
      ui.hintButton.disabled = room.hintsUsed >= 2;
      ui.answerStatus.textContent = '';
      ui.answerInput.focus({ preventScroll: true });
    }
    const elapsedAfterPrep = Math.max(0, elapsed - prepTotal);
    renderClock((room.remainingMs ?? 0) - elapsedAfterPrep);
  }

  function startPolling() {
    stopTimers();
    state.pollTimer = setInterval(fetchRoom, 2_000);
    state.clockTimer = setInterval(tickRoomClock, 150);
    fetchRoom();
  }

  function buildRevealMessage(room) {
    if (room.answerOutcome === 'exact') {
      const bonusNote = room.speedBonus ? ` (inclui +${room.speedBonus} bônus de velocidade)` : '';
      return `Você acertou! +${room.pointsEarned} pontos${bonusNote}.`;
    }
    if (room.answerOutcome === 'proximity') {
      const bonusNote = room.speedBonus ? ` (+${room.speedBonus} bônus de velocidade)` : '';
      return `Quase lá! Pontos por proximidade! +${room.pointsEarned} pontos${bonusNote}.`;
    }
    if (room.answered || state.lastGuess) {
      if (!room.answerOutcome && room.answer && state.lastGuess) {
        const outcome = classifyGuess(state.lastGuess, room.answer).outcome;
        if (outcome === 'exact') return 'Você acertou!';
        if (outcome === 'proximity') return 'Quase lá! Pontos por proximidade!';
      }
      return 'Não foi dessa vez.';
    }
    return 'Próxima rodada em instantes.';
  }

  function renderRoom(room) {
    ui.headerRoomCode.textContent = room.code;
    const players = Array.isArray(room.players) ? room.players : [];
    if (room.phase === 'lobby') {
      showScreen('lobbyScreen');
      ui.lobbyCode.textContent = room.code;
      ui.playerCount.textContent = `${players.length}/8`;
      renderPlayers(ui.lobbyPlayerList, players);
      ui.startRoomButton.hidden = !room.isHost;
      ui.startRoomButton.disabled = players.length < 2;
      ui.lobbyWaiting.hidden = room.isHost;
      return;
    }
    if (room.phase === 'finished') {
      stopTimers();
      if (ui.prepOverlay) ui.prepOverlay.hidden = true;
      renderResult(players);
      return;
    }
    const roundKey = `${room.code}:${room.round}`;
    if (state.roundKey !== roundKey) {
      state.roundKey = roundKey;
      state.lastGuess = '';
      ui.answerInput.value = '';
    }
    const imageKey = `${state.session}:${roundKey}:${room.phase}`;
    if (state.imageKey !== imageKey) loadRoomImage(imageKey, room.imageUrl);
    const mine = players.find(player => player.name === state.name);
    const prepLeft = room.phase === 'question' ? (room.prepRemainingMs ?? 0) : 0;
    renderQuestion(room.round, mine?.score ?? 0, players, room.answered, room.hintsUsed, room.hints || [], {
      prepRemainingMs: prepLeft,
      roundKey,
      showLiveStatus: room.phase === 'question',
    });
    renderClock(room.remainingMs);
    if (room.phase === 'reveal') {
      renderPrep(0, roundKey);
      ui.questionKicker.textContent = 'RESPOSTA REVELADA';
      const message = buildRevealMessage(room);
      renderReveal(room.answer || '', message, room.fastestPlayer || null);
      ui.hintButton.hidden = true;
      if (state.revealSoundKey !== roundKey) {
        state.revealSoundKey = roundKey;
        if (room.answerOutcome === 'exact') sound.play('exact');
        else if (room.answerOutcome === 'proximity') sound.play('proximity');
        else if (room.answered) sound.play('wrong');
        else sound.play('reveal');
      }
    }
  }

  async function enterRoom(action) {
    const name = playerName();
    if (!name || state.busy) return;
    const code = ui.joinCode.value.trim().toUpperCase();
    if (action === 'join' && !/^[A-Z0-9]{6}$/.test(code)) { showNotice('Digite o código de 6 caracteres da sala.', true); ui.joinCode.focus(); return; }
    sound.play('pokeball');
    const session = ++state.session;
    setBusy(true);
    try {
      state.mode = 'room';
      state.code = action === 'join' ? code : '';
      state.token = '';
      const result = await roomRequest('POST', action, action === 'create' ? { name, generation: ui.generation.value } : { name });
      if (state.session !== session) return;
      if (!result.code || !result.token) throw new Error('A sala não retornou acesso para este jogador.');
      state.code = result.code;
      state.token = result.token;
      try {
        sessionStorage.setItem('arena-room', state.code);
        sessionStorage.setItem('arena-token', state.token);
      } catch {}
      state.roundKey = '';
      startPolling();
    } catch (error) {
      if (state.session !== session) return;
      state.mode = 'home';
      showNotice(error.message, true);
    } finally { if (state.session === session) setBusy(false); }
  }

  async function sendRoomAction(action, extra = {}) {
    if (state.busy) return false;
    const session = state.session;
    state.busy = true;
    try {
      const room = await roomRequest('POST', action, extra);
      if (state.session !== session || state.mode !== 'room') return false;
      state.room = room;
      state.roomSeenAt = Date.now();
      renderRoom(room);
      return true;
    } catch (error) { if (state.session === session) showNotice(error.message, true); return false; }
    finally { if (state.session === session) state.busy = false; }
  }

  const fetchPokeApi = url => fetch(url).catch(() => { throw new Error('Não foi possível conectar à PokéAPI. Tente novamente.'); });

  async function soloPool(generation) {
    if (state.pools.has(generation)) return state.pools.get(generation);
    const response = await fetchPokeApi(`/api/pokedex?generation=${generation}`);
    if (!response.ok) throw new Error('A PokéAPI não respondeu. Tente novamente.');
    const data = await response.json();
    const ids = data.ids;
    if (!Array.isArray(ids) || !ids.length || !ids.every(Number.isInteger)) throw new Error('Não há Pokémon disponíveis para esta geração.');
    state.pools.set(generation, ids);
    return ids;
  }

  function soloPlayersList() {
    const solo = state.solo;
    return [{
      name: state.name,
      score: solo.score,
      answered: solo.phase === 'reveal',
      lastRoundPoints: solo.lastRoundPoints ?? 0,
      speedRank: 0,
    }];
  }

  async function nextSoloRound() {
    const solo = state.solo;
    if (!solo || state.mode !== 'solo') return;
    solo.round += 1;
    if (solo.round > TOTAL_ROUNDS) {
      solo.phase = 'finished';
      stopTimers();
      renderResult(soloPlayersList());
      return;
    }
    solo.phase = 'loading';
    solo.hints = [];
    solo.hintsUsed = 0;
    solo.lastRoundPoints = 0;
    solo.lastRoundOutcome = null;
    solo.guess = '';
    state.lastGuess = '';
    ui.answerInput.value = '';
    renderQuestion(solo.round, solo.score, soloPlayersList(), true, 0, [], { prepRemainingMs: 0, roundKey: `solo:${solo.round}` });
    ui.answerStatus.textContent = 'Carregando Pokémon…';
    clearImage();
    try {
      const generation = state.generation === 'all' ? 1 + Math.floor(Math.random() * 9) : Number(state.generation);
      const ids = await soloPool(generation);
      let pokemon;
      let artwork;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const available = ids.filter(id => !state.usedIds.has(id));
        const id = (available.length ? available : ids)[Math.floor(Math.random() * (available.length || ids.length))];
        const response = await fetchPokeApi(`/api/pokedex?pokemon=${id}`);
        if (!response.ok) continue;
        pokemon = await response.json();
        artwork = pokemon.artwork;
        if (artwork) break;
      }
      if (state.solo !== solo || state.mode !== 'solo') return;
      if (!pokemon || !artwork) throw new Error('Não foi possível carregar um Pokémon.');
      state.usedIds.add(pokemon.id);
      solo.pokemon = pokemon;
      solo.generation = generation;
      solo.phase = 'prep';
      solo.prepEndsAt = Date.now() + PREP_MS;
      solo.deadline = solo.prepEndsAt + QUESTION_MS;
      setImage(artwork, `solo:${solo.round}`);
      renderQuestion(solo.round, solo.score, soloPlayersList(), false, 0, [], {
        prepRemainingMs: PREP_MS,
        roundKey: `solo:${solo.round}`,
      });
      renderClock(QUESTION_MS);
    } catch (error) {
      if (state.solo !== solo || state.mode !== 'solo') return;
      showNotice(error.message, true);
      solo.round -= 1;
      goHome();
    }
  }

  function revealSolo(message, outcome = 'wrong') {
    const solo = state.solo;
    if (!solo || (solo.phase !== 'question' && solo.phase !== 'prep')) return;
    solo.phase = 'reveal';
    solo.deadline = Date.now() + REVEAL_MS;
    renderPrep(0, `solo:${solo.round}`);
    renderClock(REVEAL_MS);
    ui.questionKicker.textContent = 'RESPOSTA REVELADA';
    renderReveal(solo.pokemon.name, message);
    ui.hintButton.hidden = true;
    renderPlayers(ui.leaderboardList, soloPlayersList(), true);
    ui.yourScore.textContent = solo.score;
    sound.play(outcome === 'exact' ? 'exact' : outcome === 'proximity' ? 'proximity' : 'wrong');
  }

  async function startSolo() {
    if (state.busy || state.mode === 'solo' || !playerName()) return;
    sound.play('pokeball');
    state.session++;
    state.mode = 'solo';
    state.generation = ui.generation.value;
    state.usedIds.clear();
    state.solo = { round: 0, score: 0, phase: 'loading', prepEndsAt: 0, deadline: 0, pokemon: null, hints: [], hintsUsed: 0, lastRoundPoints: 0, lastRoundOutcome: null };
    stopTimers();
    state.clockTimer = setInterval(() => {
      const solo = state.solo;
      if (!solo || state.mode !== 'solo' || solo.phase === 'loading') return;
      const now = Date.now();
      if (solo.phase === 'prep') {
        const prepRemaining = Math.max(0, solo.prepEndsAt - now);
        if (prepRemaining > 0) {
          renderPrep(prepRemaining, `solo:${solo.round}`);
          return;
        }
        solo.phase = 'question';
        renderPrep(0, `solo:${solo.round}`);
        ui.answerInput.disabled = false;
        ui.answerButton.disabled = false;
        ui.hintButton.disabled = solo.hintsUsed >= 2;
        ui.answerStatus.textContent = '';
        ui.answerInput.focus({ preventScroll: true });
      }
      const remaining = Math.max(0, solo.deadline - now);
      renderClock(remaining);
      if (remaining === 0) {
        if (solo.phase === 'question') revealSolo('O tempo acabou.', 'wrong');
        else nextSoloRound();
      }
    }, 150);
    await nextSoloRound();
  }

  async function soloHint() {
    const solo = state.solo;
    if (!solo || solo.phase !== 'question' || Date.now() < solo.prepEndsAt || solo.hintsUsed >= 2) return;
    sound.play('hint');
    ui.hintButton.disabled = true;
    if (solo.hintsUsed === 0) {
      const types = solo.pokemon.types.map(type => TYPE_NAMES[type] || type);
      solo.hints.push(`Tipo: ${types.join(' / ')}.`);
    } else {
      solo.hints.push(`Altura: ${(solo.pokemon.height / 10).toLocaleString('pt-BR')} m · Peso: ${(solo.pokemon.weight / 10).toLocaleString('pt-BR')} kg.`);
    }
    solo.hintsUsed += 1;
    renderHints(solo.hints, solo.hintsUsed, true, false);
  }

  async function submitAnswer(event) {
    event.preventDefault();
    const guess = ui.answerInput.value.trim();
    if (!guess) { showNotice('Digite o nome do Pokémon antes de responder.', true); ui.answerInput.focus(); return; }
    if (state.mode === 'solo') {
      const solo = state.solo;
      if (!solo || solo.phase !== 'question' || Date.now() < solo.prepEndsAt) return;
      if (Date.now() >= solo.deadline) { revealSolo('O tempo acabou.', 'wrong'); return; }
      const { outcome, points } = scoreGuess(guess, solo.pokemon.name, solo.deadline - Date.now(), solo.hintsUsed);
      solo.lastRoundOutcome = outcome;
      solo.lastRoundPoints = points;
      solo.score += points;
      const message = outcome === 'exact'
        ? `Você acertou! +${points} pontos.`
        : outcome === 'proximity'
          ? `Quase lá! Pontos por proximidade! +${points} pontos.`
          : 'Não foi dessa vez.';
      revealSolo(message, outcome);
      return;
    }
    if (state.mode === 'room' && state.room?.phase === 'question' && !state.room.answered) {
      const prepLeft = Math.max(0, (state.room.prepRemainingMs ?? 0) - (Date.now() - state.roomSeenAt));
      if (prepLeft > 0) return;
      sound.play('click');
      ui.answerButton.disabled = true;
      state.lastGuess = guess;
      if (!await sendRoomAction('answer', { answer: guess })) {
        state.lastGuess = '';
        ui.answerButton.disabled = false;
      }
    }
  }

  ui.soloButton.addEventListener('click', startSolo);
  ui.createButton.addEventListener('click', () => enterRoom('create'));
  ui.joinButton.addEventListener('click', () => enterRoom('join'));
  ui.joinCode.addEventListener('input', () => { ui.joinCode.value = ui.joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  ui.joinCode.addEventListener('keydown', event => { if (event.key === 'Enter') enterRoom('join'); });
  ui.startRoomButton.addEventListener('click', () => { sound.play('pokeball'); sendRoomAction('start'); });
  ui.answerForm.addEventListener('submit', submitAnswer);
  ui.hintButton.addEventListener('click', () => {
    if (state.mode === 'solo') { soloHint(); return; }
    sound.play('hint');
    sendRoomAction('hint');
  });
  ui.copyCodeButton.addEventListener('click', async () => {
    sound.play('click');
    try { await navigator.clipboard.writeText(state.code); showNotice('Código copiado!'); }
    catch { showNotice('Selecione o código na tela para copiar.', true); }
  });

  if (ui.generation) {
    ui.generation.addEventListener('change', () => {
      syncGenerationChips(ui.generation.value);
      sound.play('click');
    });
  }
  for (const chip of genChips) {
    chip.addEventListener('click', () => {
      const gen = chip.dataset?.gen || 'all';
      if (ui.generation) ui.generation.value = gen;
      syncGenerationChips(gen);
      sound.play('click');
    });
  }
  if (ui.muteButton) {
    ui.muteButton.addEventListener('click', () => {
      sound.setMuted(!sound.isMuted());
      syncMuteUi();
    });
    syncMuteUi();
  }

  for (const backButton of [ui.brandButton, ui.newGameButton, ui.lobbyBackButton, ui.gameBackButton, ui.resultBackButton]) {
    if (backButton) {
      backButton.addEventListener('click', () => {
        sound.play('click');
        goHome();
      });
    }
  }

  try { ui.playerName.value = sessionStorage.getItem('arena-name') || ''; } catch {}
  if (ui.generation) syncGenerationChips(ui.generation.value || 'all');
  let savedCode = null;
  let savedToken = null;
  try {
    savedCode = sessionStorage.getItem('arena-room');
    savedToken = sessionStorage.getItem('arena-token');
  } catch {}
  if (savedCode && savedToken) {
    state.mode = 'room';
    state.name = ui.playerName.value;
    state.code = savedCode;
    state.token = savedToken;
    startPolling();
  }
}
