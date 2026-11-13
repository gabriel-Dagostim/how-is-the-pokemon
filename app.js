const TOTAL_ROUNDS = 10;
const QUESTION_MS = 30_000;
const REVEAL_MS = 5_000;
const TYPE_NAMES = { normal: 'Normal', fire: 'Fogo', water: 'Água', electric: 'Elétrico', grass: 'Planta', ice: 'Gelo', fighting: 'Lutador', poison: 'Venenoso', ground: 'Terra', flying: 'Voador', psychic: 'Psíquico', bug: 'Inseto', rock: 'Pedra', ghost: 'Fantasma', dragon: 'Dragão', dark: 'Sombrio', steel: 'Aço', fairy: 'Fada' };

function normalizeAnswer(value) {
  return String(value).replace(/♀/g, 'f').replace(/♂/g, 'm').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function roundScore(remainingMs, hintsUsed) {
  return Math.max(50, 100 + Math.floor(Math.max(0, remainingMs) / 1000) * 2 - hintsUsed * 25);
}

function formatClock(milliseconds) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `00:${String(seconds).padStart(2, '0')}`;
}

function displayPokemonName(name) {
  return String(name || '').replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

if (typeof window !== 'undefined') {
  const $ = id => document.getElementById(id);
  const ui = Object.fromEntries([
    'homeScreen', 'lobbyScreen', 'gameScreen', 'resultScreen', 'notice', 'playerName', 'generation', 'joinCode',
    'soloButton', 'createButton', 'joinButton', 'brandButton', 'modeBadge', 'roomBadge', 'headerRoomCode',
    'roundBadge', 'headerRound', 'lobbyCode', 'copyCodeButton', 'playerCount', 'lobbyPlayerList',
    'startRoomButton', 'lobbyWaiting', 'timerBox', 'timerText', 'yourScore', 'questionKicker', 'answerForm',
    'answerInput', 'answerButton', 'answerStatus', 'hintList', 'hintButton', 'revealCard', 'revealedName',
    'revealMessage', 'pokemonImage', 'imagePlaceholder', 'leaderboardList', 'leaderboardSub',
    'resultTitle', 'resultSummary', 'resultList', 'newGameButton',
  ].map(id => [id, $(id)]));

  const state = {
    mode: 'home', name: '', generation: 'all', code: '', token: '', room: null, solo: null,
    session: 0,
    pollTimer: null, clockTimer: null, noticeTimer: null, fetchingRoom: false, busy: false,
    imageKey: '', imageObjectUrl: '', roundKey: '', lastGuess: '', pools: new Map(), usedIds: new Set(),
  };

  function showNotice(message, error = false) {
    ui.notice.textContent = message;
    ui.notice.classList.toggle('error', error);
    ui.notice.hidden = !message;
    clearTimeout(state.noticeTimer);
    if (message) state.noticeTimer = setTimeout(() => { ui.notice.hidden = true; }, 4500);
  }

  function showScreen(name) {
    const wasHidden = ui[name].hidden;
    for (const screen of ['homeScreen', 'lobbyScreen', 'gameScreen', 'resultScreen']) ui[screen].hidden = screen !== name;
    ui.modeBadge.hidden = name === 'homeScreen';
    ui.modeBadge.textContent = state.mode === 'room' ? 'Competição' : 'Solo';
    ui.roomBadge.hidden = state.mode !== 'room' || name === 'homeScreen';
    ui.roundBadge.hidden = name !== 'gameScreen';
    if (name === 'gameScreen' && wasHidden) ui.answerInput.focus({ preventScroll: true });
  }

  function playerName() {
    const name = ui.playerName.value.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 24 || !/^[\p{L}\p{N} _-]+$/u.test(name)) {
      showNotice('Use um nome de 1 a 24 caracteres, com letras, números, espaço, _ ou -.', true);
      ui.playerName.focus();
      return '';
    }
    state.name = name;
    sessionStorage.setItem('arena-name', name);
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

  function renderPlayers(target, players, ranked = false) {
    target.replaceChildren();
    const ordered = ranked ? [...players].sort((a, b) => b.score - a.score) : players;
    ordered.forEach((player, index) => {
      const li = document.createElement('li');
      if (ranked) {
        const rank = document.createElement('span');
        rank.className = 'rank';
        rank.textContent = index === 0 ? '♛' : `${index + 1}º`;
        li.append(rank);
      }
      li.append(avatar(player.name));
      const name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = player.name;
      li.append(name);
      if (ranked) {
        const score = document.createElement('span');
        score.className = 'player-score';
        score.textContent = player.score;
        li.append(score);
        if (player.name === state.name) li.classList.add('me');
      }
      target.append(li);
    });
  }

  function renderClock(remainingMs) {
    ui.timerText.textContent = formatClock(remainingMs);
    ui.timerBox.classList.toggle('urgent', remainingMs <= 5_000);
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

  function renderHints(hints, used, enabled) {
    ui.hintList.replaceChildren();
    hints.forEach((hint, index) => {
      const li = document.createElement('li');
      const number = document.createElement('span');
      number.textContent = index + 1;
      li.append(number, document.createTextNode(hint));
      ui.hintList.append(li);
    });
    ui.hintButton.hidden = !enabled;
    ui.hintButton.disabled = used >= 2;
    ui.hintButton.textContent = used >= 2 ? 'Todas as dicas reveladas' : `Revelar dica ${used + 1}`;
  }

  function renderReveal(answer, message) {
    ui.revealCard.hidden = false;
    ui.revealedName.textContent = displayPokemonName(answer);
    ui.revealMessage.textContent = message;
    ui.pokemonImage.classList.add('revealed');
    ui.pokemonImage.alt = `Pokémon revelado: ${displayPokemonName(answer)}`;
    ui.answerForm.hidden = true;
  }

  function renderQuestion(round, score, players, answered, hintsUsed, hints) {
    showScreen('gameScreen');
    ui.headerRound.textContent = `${round}/${TOTAL_ROUNDS}`;
    ui.questionKicker.textContent = `RODADA ${round} DE ${TOTAL_ROUNDS}`;
    ui.yourScore.textContent = score;
    ui.pokemonImage.classList.remove('revealed');
    ui.pokemonImage.alt = 'Silhueta de um Pokémon misterioso';
    ui.answerForm.hidden = false;
    ui.answerInput.disabled = answered;
    ui.answerButton.disabled = answered;
    ui.answerStatus.textContent = answered ? 'Resposta enviada. Aguardando a revelação.' : '';
    ui.revealCard.hidden = true;
    renderHints(hints, hintsUsed, !answered);
    renderPlayers(ui.leaderboardList, players, true);
    ui.leaderboardSub.textContent = state.mode === 'room' ? 'ao vivo' : 'jogo solo';
  }

  function renderResult(players) {
    showScreen('resultScreen');
    const ordered = [...players].sort((a, b) => b.score - a.score);
    ui.resultTitle.textContent = state.mode === 'solo' ? 'Sua partida terminou!' : 'A arena tem um vencedor!';
    ui.resultSummary.textContent = state.mode === 'solo' ? `Você fez ${ordered[0]?.score ?? 0} pontos em ${TOTAL_ROUNDS} rodadas.` : `${ordered[0]?.name || 'Treinador'} venceu com ${ordered[0]?.score ?? 0} pontos.`;
    renderPlayers(ui.resultList, players, true);
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
    sessionStorage.removeItem('arena-room');
    sessionStorage.removeItem('arena-token');
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

  function startPolling() {
    stopTimers();
    state.pollTimer = setInterval(fetchRoom, 2_000);
    state.clockTimer = setInterval(() => {
      if (state.room && (state.room.phase === 'question' || state.room.phase === 'reveal')) renderClock(state.room.remainingMs - (Date.now() - state.roomSeenAt));
    }, 200);
    fetchRoom();
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
    if (room.phase === 'finished') { stopTimers(); renderResult(players); return; }
    const roundKey = `${room.code}:${room.round}`;
    if (state.roundKey !== roundKey) {
      state.roundKey = roundKey;
      state.lastGuess = '';
      ui.answerInput.value = '';
    }
    const imageKey = `${state.session}:${roundKey}:${room.phase}`;
    if (state.imageKey !== imageKey) loadRoomImage(imageKey, room.imageUrl);
    const mine = players.find(player => player.name === state.name);
    renderQuestion(room.round, mine?.score ?? 0, players, room.answered, room.hintsUsed, room.hints || []);
    renderClock(room.remainingMs);
    if (room.phase === 'reveal') {
      ui.questionKicker.textContent = 'RESPOSTA REVELADA';
      const message = state.lastGuess ? (normalizeAnswer(state.lastGuess) === normalizeAnswer(room.answer) ? 'Você acertou!' : 'Não foi dessa vez.') : 'Próxima rodada em instantes.';
      renderReveal(room.answer || '', message);
      ui.hintButton.hidden = true;
    }
  }

  async function enterRoom(action) {
    const name = playerName();
    if (!name || state.busy) return;
    const code = ui.joinCode.value.trim().toUpperCase();
    if (action === 'join' && !/^[A-Z0-9]{6}$/.test(code)) { showNotice('Digite o código de 6 caracteres da sala.', true); ui.joinCode.focus(); return; }
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
      sessionStorage.setItem('arena-room', state.code);
      sessionStorage.setItem('arena-token', state.token);
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
    const response = await fetchPokeApi(`https://pokeapi.co/api/v2/generation/${generation}/`);
    if (!response.ok) throw new Error('A PokéAPI não respondeu. Tente novamente.');
    const data = await response.json();
    const ids = data.pokemon_species.map(species => Number(species.url.match(/\/(\d+)\/?$/)?.[1])).filter(Number.isInteger);
    if (!ids.length) throw new Error('Não há Pokémon disponíveis para esta geração.');
    state.pools.set(generation, ids);
    return ids;
  }

  async function nextSoloRound() {
    const solo = state.solo;
    if (!solo || state.mode !== 'solo') return;
    solo.round += 1;
    if (solo.round > TOTAL_ROUNDS) {
      solo.phase = 'finished';
      stopTimers();
      renderResult([{ name: state.name, score: solo.score }]);
      return;
    }
    solo.phase = 'loading';
    solo.hints = [];
    solo.hintsUsed = 0;
    solo.guess = '';
    state.lastGuess = '';
    ui.answerInput.value = '';
    renderQuestion(solo.round, solo.score, [{ name: state.name, score: solo.score }], true, 0, []);
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
        const response = await fetchPokeApi(`https://pokeapi.co/api/v2/pokemon/${id}/`);
        if (!response.ok) continue;
        pokemon = await response.json();
        artwork = pokemon.sprites?.other?.['official-artwork']?.front_default || pokemon.sprites?.front_default;
        if (artwork) break;
      }
      if (state.solo !== solo || state.mode !== 'solo') return;
      if (!pokemon || !artwork) throw new Error('Não foi possível carregar um Pokémon.');
      state.usedIds.add(pokemon.id);
      solo.pokemon = pokemon;
      solo.generation = generation;
      solo.phase = 'question';
      solo.deadline = Date.now() + QUESTION_MS;
      setImage(artwork, `solo:${solo.round}`);
      renderQuestion(solo.round, solo.score, [{ name: state.name, score: solo.score }], false, 0, []);
      renderClock(QUESTION_MS);
    } catch (error) {
      if (state.solo !== solo || state.mode !== 'solo') return;
      showNotice(error.message, true);
      solo.round -= 1;
      goHome();
    }
  }

  function revealSolo(message) {
    const solo = state.solo;
    if (!solo || solo.phase !== 'question') return;
    solo.phase = 'reveal';
    solo.deadline = Date.now() + REVEAL_MS;
    renderClock(REVEAL_MS);
    ui.questionKicker.textContent = 'RESPOSTA REVELADA';
    renderReveal(solo.pokemon.name, message);
    ui.hintButton.hidden = true;
    renderPlayers(ui.leaderboardList, [{ name: state.name, score: solo.score }], true);
    ui.yourScore.textContent = solo.score;
  }

  async function startSolo() {
    if (state.busy || state.mode === 'solo' || !playerName()) return;
    state.session++;
    state.mode = 'solo';
    state.generation = ui.generation.value;
    state.usedIds.clear();
    state.solo = { round: 0, score: 0, phase: 'loading', deadline: 0, pokemon: null, hints: [], hintsUsed: 0 };
    stopTimers();
    state.clockTimer = setInterval(() => {
      const solo = state.solo;
      if (!solo || state.mode !== 'solo' || solo.phase === 'loading') return;
      const remaining = Math.max(0, solo.deadline - Date.now());
      renderClock(remaining);
      if (remaining === 0) {
        if (solo.phase === 'question') revealSolo('O tempo acabou.');
        else nextSoloRound();
      }
    }, 200);
    await nextSoloRound();
  }

  async function soloHint() {
    const solo = state.solo;
    if (!solo || solo.phase !== 'question' || solo.hintsUsed >= 2) return;
    ui.hintButton.disabled = true;
    if (solo.hintsUsed === 0) {
      const types = solo.pokemon.types.map(entry => TYPE_NAMES[entry.type.name] || entry.type.name);
      solo.hints.push(`Tipo: ${types.join(' / ')}.`);
    } else {
      solo.hints.push(`Altura: ${(solo.pokemon.height / 10).toLocaleString('pt-BR')} m · Peso: ${(solo.pokemon.weight / 10).toLocaleString('pt-BR')} kg.`);
    }
    solo.hintsUsed += 1;
    renderHints(solo.hints, solo.hintsUsed, true);
  }

  async function submitAnswer(event) {
    event.preventDefault();
    const guess = ui.answerInput.value.trim();
    if (!guess) { showNotice('Digite o nome do Pokémon antes de responder.', true); ui.answerInput.focus(); return; }
    if (state.mode === 'solo') {
      const solo = state.solo;
      if (!solo || solo.phase !== 'question') return;
      if (Date.now() >= solo.deadline) { revealSolo('O tempo acabou.'); return; }
      const correct = normalizeAnswer(guess) === normalizeAnswer(solo.pokemon.name);
      const points = correct ? roundScore(solo.deadline - Date.now(), solo.hintsUsed) : 0;
      solo.score += points;
      revealSolo(correct ? `Você acertou! +${points} pontos.` : 'Não foi dessa vez.');
      return;
    }
    if (state.mode === 'room' && state.room?.phase === 'question' && !state.room.answered) {
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
  ui.startRoomButton.addEventListener('click', () => sendRoomAction('start'));
  ui.answerForm.addEventListener('submit', submitAnswer);
  ui.hintButton.addEventListener('click', () => state.mode === 'solo' ? soloHint() : sendRoomAction('hint'));
  ui.copyCodeButton.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.code); showNotice('Código copiado!'); }
    catch { showNotice('Selecione o código na tela para copiar.', true); }
  });
  ui.brandButton.addEventListener('click', goHome);
  ui.newGameButton.addEventListener('click', goHome);
  ui.playerName.value = sessionStorage.getItem('arena-name') || '';
  const savedCode = sessionStorage.getItem('arena-room');
  const savedToken = sessionStorage.getItem('arena-token');
  if (savedCode && savedToken) {
    state.mode = 'room';
    state.name = ui.playerName.value;
    state.code = savedCode;
    state.token = savedToken;
    startPolling();
  }
}
