const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

function element() {
  return {
    hidden: false, value: '', disabled: false, textContent: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, append() {}, replaceChildren() {},
    setAttribute() {}, removeAttribute() {}, focus() {},
  };
}

function app(fetcher) {
  const elements = new Map();
  const handlers = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const node = element();
        node.addEventListener = (type, handler) => handlers.set(`${id}:${type}`, handler);
        elements.set(id, node);
      }
      return elements.get(id);
    },
    createElement: element,
    createTextNode: text => ({ textContent: text }),
  };
  const storage = new Map();
  const context = vm.createContext({
    window: {}, document, fetch: fetcher, console,
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    URL: { revokeObjectURL() {} },
  });
  vm.runInContext(readFileSync(join(__dirname, '..', 'app.js'), 'utf8'), context);
  elements.get('playerName').value = 'Gabriel';
  elements.get('generation').value = '1';
  return { elements, handlers };
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
