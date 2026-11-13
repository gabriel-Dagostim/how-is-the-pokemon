import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { imageForPhase } from '../lib/image.mjs';

test('question art is black while transparent pixels stay transparent', async () => {
  const original = await sharp(Buffer.from([255, 42, 10, 255, 12, 80, 200, 0]), {
    raw: { width: 2, height: 1, channels: 4 },
  }).png().toBuffer();
  const hidden = await imageForPhase(original, 'question');
  const pixels = await sharp(hidden).ensureAlpha().raw().toBuffer();
  assert.deepEqual([...pixels], [0, 0, 0, 255, 0, 0, 0, 0]);
  assert.equal(await imageForPhase(original, 'reveal'), original);
});
