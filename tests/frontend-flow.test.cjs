const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

function element() {
  return {
    hidden: false, value: '', disabled: false, textContent: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, append() {}, replaceChildren() {},
    setAttribute() {}, removeAttribute() {}, focus() {},
  };
}

function app(fetcher, { withTimers = false } = {}) {
  const elements = new Map();
  const handlers = new Map();
  const intervals = [];
  let now = 1_000_000;
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const node = element();
        node.addEventListener = (type, handler) => handlers.set(`${id}:${type}`, handler);
        elements.set(id, node);
      }
      return elements.get(id);
    },
    querySelectorAll: () => [],
    createElement: element,
    createTextNode: text => ({ textContent: text }),
  };
  const storage = new Map();
  class FakeDate extends Date {
    static now() { return now; }
  }
  const context = vm.createContext({
    window: {}, document, fetch: fetcher, console,
    Date: withTimers ? FakeDate : Date,
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setInterval: fn => { intervals.push(fn); return intervals.length; },
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    URL: { revokeObjectURL() {} },
  });
  vm.runInContext(readFileSync(join(__dirname, '..', 'public', 'app.js'), 'utf8'), context);
  elements.get('playerName').value = 'Gabriel';
  elements.get('generation').value = '1';
  return {
    elements,
    handlers,
    tick(ms) {
      now += ms;
      for (const fn of intervals) fn();
    },
  };
}

test('partida solo descarta resposta tardia após voltar ao início e ignora clique duplo', async () => {
  let resolvePokemon;
  let pokemonRequests = 0;
  const { elements, handlers } = app(url => {
    if (url.includes('/generation/')) return Promise.resolve({ ok: true, json: async () => ({ pokemon_species: [{ url: 'https://pokeapi.co/api/v2/pokemon-species/25/' }] }) });
    pokemonRequests++;
    return new Promise(resolve => { resolvePokemon = resolve; });
  });
  const first = handlers.get('soloButton:click')();
  const second = handlers.get('soloButton:click')();
  await new Promise(setImmediate);
  assert.equal(pokemonRequests, 1);
  handlers.get('brandButton:click')();
  resolvePokemon({ ok: true, json: async () => ({ id: 25, name: 'pikachu', sprites: { other: { 'official-artwork': { front_default: 'https://example.com/25.png' } } } }) });
  await Promise.all([first, second]);
  assert.equal(elements.get('homeScreen').hidden, false);
  assert.equal(elements.get('gameScreen').hidden, true);
});

test('criação tardia de sala não reabre o lobby após voltar ao início', async () => {
  let resolveCreate;
  let roomReads = 0;
  const lobby = { code: 'ABC234', phase: 'lobby', players: [{ name: 'Gabriel', score: 0 }], isHost: true };
  const { elements, handlers } = app((url, options) => {
    if (options?.method === 'POST') return new Promise(resolve => { resolveCreate = resolve; });
    roomReads++;
    return Promise.resolve({ ok: true, json: async () => lobby });
  });
  const pending = handlers.get('createButton:click')();
  handlers.get('brandButton:click')();
  resolveCreate({ ok: true, json: async () => ({ code: 'ABC234', token: 'A'.repeat(32) }) });
  await pending;
  await new Promise(setImmediate);
  assert.equal(elements.get('homeScreen').hidden, false);
  assert.equal(elements.get('lobbyScreen').hidden, true);
  assert.equal(roomReads, 0);
});

test('ação tardia da sala não reabre a partida após voltar ao início', async () => {
  let resolveStart;
  const lobby = { code: 'ABC234', phase: 'lobby', players: [{ name: 'Gabriel', score: 0 }, { name: 'Ana', score: 0 }], isHost: true };
  const { elements, handlers } = app((url, options) => {
    if (options?.method === 'POST') {
      const action = JSON.parse(options.body).action;
      if (action === 'create') return Promise.resolve({ ok: true, json: async () => ({ code: 'ABC234', token: 'A'.repeat(32) }) });
      if (action === 'start') return new Promise(resolve => { resolveStart = resolve; });
    }
    return Promise.resolve({ ok: true, json: async () => lobby });
  });
  handlers.get('createButton:click')();
  await new Promise(setImmediate);
  const pending = handlers.get('startRoomButton:click')();
  handlers.get('brandButton:click')();
  resolveStart({ ok: true, json: async () => ({ ...lobby, phase: 'question', round: 1, remainingMs: 30_000, hints: [], hintsUsed: 0, answered: false, imageUrl: null }) });
  await pending;
  assert.equal(elements.get('homeScreen').hidden, false);
  assert.equal(elements.get('gameScreen').hidden, true);
});

test('falha de rede no solo mostra mensagem útil em português', async () => {
  const { elements, handlers } = app(() => Promise.reject(new TypeError('Failed to fetch')));
  await handlers.get('soloButton:click')();
  assert.match(elements.get('notice').textContent, /PokéAPI.*Tente novamente/);
});

test('solo respeita contagem de preparo de 2s e aceita pontuação por proximidade após liberar', async () => {
  const { elements, handlers, tick } = app(url => {
    if (url.includes('/generation/')) {
      return Promise.resolve({ ok: true, json: async () => ({ pokemon_species: [{ url: 'https://pokeapi.co/api/v2/pokemon-species/6/' }] }) });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({
        id: 6,
        name: 'charizard',
        types: [{ type: { name: 'fire' } }],
        height: 17,
        weight: 905,
        sprites: { other: { 'official-artwork': { front_default: 'https://example.com/6.png' } } },
      }),
    });
  }, { withTimers: true });

  await handlers.get('soloButton:click')();
  assert.equal(elements.get('prepOverlay').hidden, false);
  assert.equal(elements.get('answerInput').disabled, true);

  // Submitting during 2s prep is ignored
  elements.get('answerInput').value = 'charisard';
  await handlers.get('answerForm:submit')({ preventDefault() {} });
  assert.equal(elements.get('revealCard').hidden, true);

  // Advance 2s prep -> turn opens
  tick(2_000);
  assert.equal(elements.get('prepOverlay').hidden, true);
  assert.equal(elements.get('answerInput').disabled, false);

  await handlers.get('answerForm:submit')({ preventDefault() {} });
  assert.equal(elements.get('revealCard').hidden, false);
  assert.match(elements.get('revealMessage').textContent, /Quase lá! Pontos por proximidade!/);
  assert.equal(elements.get('yourScore').textContent, 112);

  // Back button from game screen returns home cleanly
  handlers.get('gameBackButton:click')();
  assert.equal(elements.get('homeScreen').hidden, false);
  assert.equal(elements.get('gameScreen').hidden, true);
});

test('botões de voltar do lobby e resultado retornam ao início e botão de som alterna sem AudioContext', async () => {
  const lobby = { code: 'ABC234', phase: 'lobby', players: [{ name: 'Gabriel', score: 0 }], isHost: true };
  const { elements, handlers } = app((url, options) => {
    if (options?.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ code: 'ABC234', token: 'A'.repeat(32) }) });
    return Promise.resolve({ ok: true, json: async () => lobby });
  });

  handlers.get('muteButton:click')();
  assert.equal(elements.get('muteLabel').textContent, 'Mudo');
  handlers.get('muteButton:click')();
  assert.equal(elements.get('muteLabel').textContent, 'Som');

  await handlers.get('createButton:click')();
  await new Promise(setImmediate);
  assert.equal(elements.get('lobbyScreen').hidden, false);
  handlers.get('lobbyBackButton:click')();
  assert.equal(elements.get('homeScreen').hidden, false);
  assert.equal(elements.get('lobbyScreen').hidden, true);

  handlers.get('resultBackButton:click')();
  assert.equal(elements.get('homeScreen').hidden, false);
});
