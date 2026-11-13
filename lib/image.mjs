import sharp from 'sharp';
import { GameError } from './game.mjs';

export async function imageForPhase(original, phase) {
  if (phase === 'reveal' || phase === 'finished') return original;
  if (phase !== 'question') throw new GameError('Imagem indisponível nesta fase.', 409);
  const { data, info } = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += info.channels) {
    data[index] = 0;
    data[index + 1] = 0;
    data[index + 2] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
}
