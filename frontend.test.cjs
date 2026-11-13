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
