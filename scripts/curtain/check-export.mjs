import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { leatherBase64 } from '../../src/screens/game/curtain/assets.generated.ts';

if (!process.argv[2]) throw new Error('Pass the Expo export directory.');
const root = resolve(process.argv[2], '_expo/static/js');
const texture = Buffer.from(leatherBase64);
for (const platform of ['ios', 'android', 'web']) {
  const directory = join(root, platform);
  const bundles = readdirSync(directory).map((name) => readFileSync(join(directory, name)));
  if (!bundles.some((bytes) => bytes.includes(texture))) throw new Error(`${platform} lost the exact texture mip stream.`);
  if (platform === 'web' && bundles.some((bytes) => bytes.includes('MakeWebGPUCanvasContext'))) {
    throw new Error('Web export imported the native graphics module.');
  }
  console.log(`${platform} export retains the exact nine-mip texture.`);
}
