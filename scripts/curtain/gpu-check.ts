import { mountCurtain, type CurtainSurface, type RenderInput } from '../../src/screens/game/curtain/renderer';

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function checkCurtainGpu(): Promise<string[]> {
  const adapter = await navigator.gpu?.requestAdapter();
  expect(adapter !== null && adapter !== undefined, 'A real WebGPU adapter is required.');
  const results: string[] = [];
  const errors: string[] = [];
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
  let time = 0;
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const clock = {
    now: () => time,
    request: (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; },
    cancel: (id: number) => { frames.delete(id); },
  };
  let target: GPUTexture | null = null;
  let width = 0;
  let height = 0;
  let presented = 0;
  let released = 0;
  let ready = 0;
  let fallback = 0;
  const surface: CurtainSurface = {
    acquire: async () => device,
    format: 'rgba8unorm',
    context: {
      configure: () => {},
      unconfigure: () => { released++; },
      getCurrentTexture: () => {
        expect(target !== null, 'Target must be sized before drawing.');
        return target;
      },
    },
    resize: (w, h) => {
      target?.destroy();
      width = w;
      height = h;
      target = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    },
    present: () => { presented++; },
  };
  const input: RenderInput = { palette: { away: '#FF0000', home: '#0000FF' }, animate: true, visible: true, width: 256, height: 688, pixelRatio: 1 };
  const owner = mountCurtain(surface, input, () => ready++, () => fallback++, clock);
  await Promise.resolve();
  expect(owner.status === 'ready', 'Acquisition should prepare the real pipeline.');
  expect(ready === 0, 'Acquisition must not reveal a frame.');

  function frame(now: number): void {
    time = now;
    const pending = [...frames.values()];
    expect(pending.length === 1, 'Exactly one frame must be scheduled.');
    frames.clear();
    pending[0](now);
  }
  async function pixels(): Promise<Uint8Array> {
    expect(target !== null, 'A rendered texture is required.');
    const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
    const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const source = new Uint8Array(readback.getMappedRange());
    const packed = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) packed.set(source.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
    readback.unmap();
    readback.destroy();
    return packed;
  }
  function equal(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  frame(0);
  const first = await pixels();
  expect(Number(ready) === 1, 'Only GPU completion reveals the first frame.');
  expect(presented === 1, 'A submitted frame must present exactly once.');
  const left = (160 * width + 20) * 4;
  const right = (160 * width + width - 20) * 4;
  expect(first[left] > first[left + 2], 'Away red must be on the left.');
  expect(first[right + 2] > first[right], 'Home blue must be on the right.');
  const belowFade = (Math.ceil(height * 0.7) * width + 20) * 4;
  expect(first[belowFade] === 0 && first[belowFade + 3] === 255, 'The bottom beyond the 60% scissor must remain black.');
  results.push('Real GPU shader, texture uploads, color sides, scissor and first-completion reveal passed.');

  frame(10000);
  const moving = await pixels();
  expect(!equal(first, moving), 'Active wind must change the real rendered pixels.');
  owner.update({ ...input, visible: false, animate: false });
  expect(frames.size === 0, 'Hidden rendering must stop.');
  time = 70000;
  owner.update(input);
  frame(time);
  const resumed = await pixels();
  expect(equal(moving, resumed), 'Hidden time must not change resumed wind pixels.');
  owner.update({ ...input, animate: false });
  frame(time);
  const reduced = await pixels();
  expect(equal(moving, reduced), 'Reduced motion must hold the last wind phase.');
  expect(frames.size === 0, 'Reduced motion must release the frame loop.');
  results.push('Active wind changes pixels; hidden and reduced motion preserve pixels and stop scheduling.');

  time = 80000;
  owner.update({ ...input, animate: false, palette: { away: '#0000FF', home: '#FF0000' } });
  frame(time);
  const changed = await pixels();
  expect(changed[left + 2] > changed[left], 'A changed reduced-motion palette must draw immediately.');
  expect(frames.size === 0, 'A static palette change draws once.');
  owner.update({ ...input, animate: false, palette: null, width: 128, pixelRatio: 2 });
  frame(time);
  const resized = await pixels();
  expect(width === 256 && height === 1376, 'Drawing buffer must use physical size.');
  expect(!equal(changed, resized), 'DPR and logical grain scale changes must redraw.');
  expect(Number(ready) === 1 && fallback === 0, 'Refresh and resize must preserve readiness.');
  results.push('Static palette changes, null retention and DPR resizing passed without recreating the owner.');

  owner.update(input);
  device.destroy();
  await device.lost;
  await Promise.resolve();
  expect(String(owner.status) === 'unavailable' && Number(fallback) === 1 && frames.size === 0, 'Device loss must restore fallback and stop the loop.');
  owner.dispose();
  owner.dispose();
  expect(released === 1, 'Context unconfiguration must be idempotent.');
  surface.context.getCurrentTexture().destroy();
  expect(errors.length === 0, `GPU validation errors: ${errors.join('\n')}`);
  results.push('Device loss, disposal and context release passed with zero GPU validation errors.');

  const lateAdapter = await navigator.gpu.requestAdapter();
  expect(lateAdapter !== null, 'A late-device adapter is required.');
  const lateDevice = await lateAdapter.requestDevice();
  let resolveDevice: (device: GPUDevice) => void = () => { throw new Error('Acquisition not started.'); };
  const pending = new Promise<GPUDevice>((resolve) => { resolveDevice = resolve; });
  const cancelled = mountCurtain({ ...surface, acquire: () => pending }, input, () => { throw new Error('Disposed reveal.'); }, () => { throw new Error('Disposed fallback.'); }, clock);
  cancelled.dispose();
  resolveDevice(lateDevice);
  const loss = await lateDevice.lost;
  expect(loss.reason === 'destroyed', 'Late acquired devices must be destroyed after disposal.');
  expect(frames.size === 0, 'Late acquisition must not schedule a frame.');
  results.push('Disposal during real device acquisition destroys the late device without rendering.');
  return results;
}
