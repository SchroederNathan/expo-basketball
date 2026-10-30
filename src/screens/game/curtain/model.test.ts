import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { curtainShader, leatherBase64 } from './assets.generated';
import { FabricFrame, gridIndices, INDEX_COUNT, leatherBytes } from './model';
import provenance from './provenance.json';

const red = { away: '#FF0000', home: '#0000FF' };
const blue = { away: '#0000FF', home: '#FF0000' };
const green = { away: '#00FF00', home: '#00FF00' };

test('uniform contract uses physical dimensions, logical grain scale, zero padding and exact color offsets', () => {
  const frame = new FabricFrame();
  frame.update(red, true, false, 0);
  frame.pack(0, 1206, 2064, 402);
  const packed = frame.pack(1000, 1206, 2064, 402);
  assert.equal(packed.byteLength, 64);
  assert.deepEqual([...packed], [1, 1206, 2064, 0, 402, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1]);
});

test('wind accumulates active time and resumes without counting hidden or reduced time', () => {
  const frame = new FabricFrame();
  frame.update(red, true, false, 0);
  assert.equal(frame.pack(0, 402, 688, 402)[0], 0);
  assert.equal(frame.pack(1000, 402, 688, 402)[0], 1);
  frame.pause();
  assert.equal(frame.pack(61000, 402, 688, 402)[0], 1);
  assert.equal(frame.pack(62000, 402, 688, 402)[0], 2);
  frame.update(red, false, true, 62000);
  assert.equal(frame.pack(92000, 402, 688, 402)[0], 2);
  frame.update(null, true, true, 100000);
  assert.equal(frame.pack(100000, 402, 688, 402)[0], 2);
});

test('refresh retains the palette and interrupted transitions start from displayed colors', () => {
  const frame = new FabricFrame();
  frame.update(red, true, false, 0);
  frame.update(blue, true, true, 1000);
  const midpoint = frame.pack(1400, 402, 688, 402).slice();
  assert.equal(midpoint[8], 0.5);
  assert.equal(midpoint[10], 0.5);
  frame.update(green, true, true, 1400);
  assert.deepEqual(frame.pack(1400, 402, 688, 402), midpoint);
  frame.update(null, true, true, 1500);
  assert.deepEqual([...frame.pack(2200, 402, 688, 402).slice(8)], [0, 1, 0, 1, 0, 1, 0, 1]);
});

test('disabling animation snaps changed palettes and preserves unchanged wall-time transitions', () => {
  const frame = new FabricFrame();
  frame.update(red, true, false, 0);
  frame.update(blue, true, true, 1000);
  frame.update(blue, false, true, 1200);
  const unchanged = frame.pack(1400, 402, 688, 402);
  assert.equal(unchanged[8], 0.5);
  assert.equal(unchanged[10], 0.5);
  frame.update(green, false, true, 1400);
  assert.deepEqual([...frame.pack(1400, 402, 688, 402).slice(8)], [0, 1, 0, 1, 0, 1, 0, 1]);
});

test('grid winding and source shader and Rust texture bytes match the original contracts', () => {
  const grid = gridIndices();
  assert.equal(grid.length, INDEX_COUNT);
  for (let cell = 0; cell < 96 * 164; cell++) {
    const a = Math.floor(cell / 96) * 97 + cell % 96;
    assert.deepEqual([...grid.subarray(cell * 6, cell * 6 + 6)], [a, a + 1, a + 97, a + 97, a + 1, a + 98]);
  }
  const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(curtainShader), provenance.shaderSha256);
  assert.equal(curtainShader, readFileSync(new URL('./curtain.wgsl', import.meta.url), 'utf8'));
  const texture = leatherBytes(leatherBase64);
  assert.equal(texture.length, 349524);
  assert.equal(hash(texture), provenance.textureSha256);
  let offset = 256 * 256 * 4;
  let previous = 0;
  for (let size = 128; size >= 1; size /= 2) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        for (let c = 0; c < 4; c++) {
          const sample = (dx: number, dy: number) => texture[previous + ((y * 2 + dy) * size * 2 + x * 2 + dx) * 4 + c];
          const mean = Math.floor((sample(0, 0) + sample(1, 0) + sample(0, 1) + sample(1, 1) + 2) / 4);
          assert.equal(texture[offset + (y * size + x) * 4 + c], mean);
        }
      }
    }
    previous = offset;
    offset += size * size * 4;
  }
});
