const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const context = vm.createContext({
  document: { getElementById: () => ({}) },
  console,
});
vm.runInContext(readFileSync(join(__dirname, 'app.js'), 'utf8'), context);

test('aceita nomes de Pokémon sem acento, pontuação ou diferença de caixa', () => {
  assert.equal(context.normalizeAnswer('  Mr. Mime  '), 'mrmime');
  assert.equal(context.normalizeAnswer('Flabébé'), 'flabebe');
  assert.equal(context.normalizeAnswer('Nidoran♀'), 'nidoranf');
  assert.equal(context.normalizeAnswer('Nidoran♂'), 'nidoranm');
});

test('calcula a pontuação com tempo restante e custo das dicas', () => {
  assert.equal(context.roundScore(30_000, 0), 160);
  assert.equal(context.roundScore(15_000, 2), 80);
  assert.equal(context.roundScore(0, 2), 50);
});

test('pontua por proximidade da palavra sem falso positivo em nomes curtos', () => {
  const exact = context.scoreGuess('Charizard', 'charizard', 30_000, 0);
  assert.equal(exact.outcome, 'exact');
  assert.equal(exact.points, 160);

  const close = context.scoreGuess('charisard', 'charizard', 30_000, 0);
  assert.equal(close.outcome, 'proximity');
  assert.equal(close.points, 112);

  const ptTypo = context.scoreGuess('bulbassauro', 'bulbasaur', 20_000, 0);
  assert.equal(ptTypo.outcome, 'proximity');
  assert.equal(ptTypo.points, 98);

  const shortMiss = context.scoreGuess('mewtwo', 'mew', 30_000, 0);
  assert.equal(shortMiss.outcome, 'wrong');
  assert.equal(shortMiss.points, 0);

  const evoMiss = context.scoreGuess('pidgey', 'pidgeotto', 30_000, 0);
  assert.equal(evoMiss.outcome, 'wrong');
  assert.equal(evoMiss.points, 0);
});
