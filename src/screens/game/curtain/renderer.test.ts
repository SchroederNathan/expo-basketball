import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountCurtain, type CurtainSurface, type RenderInput } from './renderer';

const input: RenderInput = {
  palette: { away: '#FF0000', home: '#0000FF' }, animate: true, visible: true, width: 402, height: 688, pixelRatio: 2,
};

function unavailableSurface(acquire: CurtainSurface['acquire']): CurtainSurface {
  return {
    acquire, format: 'rgba8unorm', resize: () => assert.fail('unavailable surface resized'), present: () => assert.fail('unavailable surface presented'),
    context: {
      configure: () => assert.fail('unavailable surface configured'),
      unconfigure: () => assert.fail('unconfigured surface released'),
      getCurrentTexture: () => assert.fail('unavailable surface rendered'),
    },
  };
}
const clock = { now: () => 0, request: () => assert.fail('unavailable GPU scheduled work'), cancel: () => assert.fail('no frame was requested') };

test('adapter absence and rejected acquisition enter fallback once without a frame loop', async () => {
  for (const acquire of [async () => null, async () => { throw new Error('adapter unavailable'); }]) {
    let fallback = 0;
    const owner = mountCurtain(unavailableSurface(acquire), input, () => assert.fail('GPU is absent'), () => fallback++, clock);
    await Promise.resolve();
    assert.equal(owner.status, 'unavailable');
    assert.equal(fallback, 1);
    owner.update(input);
    owner.dispose();
    owner.dispose();
    assert.equal(owner.status, 'disposed');
    assert.equal(fallback, 1);
  }
});

test('disposal cancels pending acquisition and never announces a stale fallback', async () => {
  let resolve: (device: GPUDevice | null) => void = () => assert.fail('acquisition was not started');
  const pending = new Promise<GPUDevice | null>((done) => { resolve = done; });
  const owner = mountCurtain(unavailableSurface(() => pending), input, () => assert.fail('disposed reveal'), () => assert.fail('disposed fallback'), clock);
  assert.equal(owner.status, 'initializing');
  owner.dispose();
  resolve(null);
  await Promise.resolve();
  assert.equal(owner.status, 'disposed');
});
