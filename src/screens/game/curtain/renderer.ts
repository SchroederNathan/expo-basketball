/// <reference types="@webgpu/types" />
import { curtainShader, leatherBase64 } from './assets.generated';
import { FabricFrame, gridIndices, INDEX_COUNT, leatherBytes, type Palette } from './model';

export type RenderInput = Readonly<{
  palette: Palette | null;
  animate: boolean;
  visible: boolean;
  width: number;
  height: number;
  pixelRatio: number;
}>;

export type CurtainSurface = Readonly<{
  acquire: () => Promise<GPUDevice | null>;
  context: Pick<GPUCanvasContext, 'configure' | 'unconfigure' | 'getCurrentTexture'>;
  format: GPUTextureFormat;
  resize: (width: number, height: number) => void;
  present: () => void;
}>;

type Resources = Readonly<{
  device: GPUDevice;
  indices: GPUBuffer;
  uniforms: GPUBuffer;
  texture: GPUTexture;
  pipeline: GPURenderPipeline;
  group: GPUBindGroup;
}>;
type Lifecycle =
  | { kind: 'initializing' }
  | { kind: 'ready'; resources: Resources; completionQueued: boolean }
  | { kind: 'unavailable' }
  | { kind: 'disposed' };

type Runtime = Readonly<{
  now: () => number;
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
}>;
const runtime: Runtime = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
};

function build(device: GPUDevice, format: GPUTextureFormat): Resources {
  const grid = gridIndices();
  const indices = device.createBuffer({ label: 'fabric grid', size: grid.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(indices, 0, grid);
  const uniforms = device.createBuffer({ label: 'fabric uniforms', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const texture = device.createTexture({
    label: 'basketball leather normal and height', size: [256, 256], mipLevelCount: 9,
    format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const bytes = leatherBytes(leatherBase64);
  let offset = 0;
  for (let mipLevel = 0, size = 256; mipLevel < 9; mipLevel++, size /= 2) {
    const length = size * size * 4;
    device.queue.writeTexture({ texture, mipLevel }, bytes.subarray(offset, offset + length), { bytesPerRow: size * 4, rowsPerImage: size }, [size, size]);
    offset += length;
  }
  const sampler = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear' });
  const shader = device.createShaderModule({ label: 'Exact curtain', code: curtainShader });
  const pipeline = device.createRenderPipeline({
    label: 'team fabric', layout: 'auto',
    vertex: { module: shader, entryPoint: 'vs' },
    fragment: { module: shader, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: texture.createView() },
      { binding: 2, resource: sampler },
    ],
  });
  return { device, indices, uniforms, texture, pipeline, group };
}

function destroy(resources: Resources): void {
  resources.indices.destroy();
  resources.uniforms.destroy();
  resources.texture.destroy();
  resources.device.destroy();
}

export function mountCurtain(
  surface: CurtainSurface,
  initial: RenderInput,
  onReady: () => void,
  onUnavailable: () => void,
  clock: Runtime = runtime,
) {
  let state: Lifecycle = { kind: 'initializing' };
  let input = initial;
  let frame: number | null = null;
  let configured = false;
  let pixelWidth = 0;
  let pixelHeight = 0;
  const fabric = new FabricFrame();
  fabric.update(input.palette, input.animate, false, clock.now());

  function stop(): void {
    if (frame !== null) clock.cancel(frame);
    frame = null;
    fabric.pause();
  }

  function release(): void {
    stop();
    if (configured) surface.context.unconfigure();
    configured = false;
    if (state.kind === 'ready') destroy(state.resources);
  }

  function unavailable(): void {
    if (state.kind === 'disposed' || state.kind === 'unavailable') return;
    release();
    state = { kind: 'unavailable' };
    onUnavailable();
  }

  function schedule(): void {
    if (frame === null && state.kind === 'ready' && input.visible && fabric.hasPalette && input.width > 0 && input.height > 0) {
      frame = clock.request(render);
    }
  }

  function render(): void {
    frame = null;
    if (state.kind !== 'ready' || !input.visible) return;
    const current = state;
    const gpu = current.resources;
    const width = Math.max(1, Math.round(input.width * input.pixelRatio));
    const height = Math.max(1, Math.round(input.height * input.pixelRatio));
    if (!configured || width !== pixelWidth || height !== pixelHeight) {
      surface.resize(width, height);
      surface.context.configure({ device: gpu.device, format: surface.format, alphaMode: 'opaque', colorSpace: 'srgb' });
      configured = true;
      pixelWidth = width;
      pixelHeight = height;
    }
    gpu.device.queue.writeBuffer(gpu.uniforms, 0, fabric.pack(clock.now(), width, height, input.width));
    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: surface.context.getCurrentTexture().createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store',
    }] });
    pass.setPipeline(gpu.pipeline);
    pass.setScissorRect(0, 0, width, Math.ceil(height * 0.6));
    pass.setBindGroup(0, gpu.group);
    pass.setIndexBuffer(gpu.indices, 'uint16');
    pass.drawIndexed(INDEX_COUNT);
    pass.end();
    gpu.device.queue.submit([encoder.finish()]);
    surface.present();
    if (!current.completionQueued) {
      current.completionQueued = true;
      void gpu.device.queue.onSubmittedWorkDone().then(() => {
        if (state !== current) return;
        onReady();
      }, () => {
        if (state === current) unavailable();
      });
    }
    if (input.animate) schedule();
  }

  async function initialize(): Promise<void> {
    // Only acquisition failure is an unsupported-GPU fallback. Shader and API errors must surface.
    let device: GPUDevice | null;
    try {
      device = await surface.acquire();
    } catch {
      unavailable();
      return;
    }
    if (state.kind !== 'initializing') {
      device?.destroy();
      return;
    }
    if (!device) {
      unavailable();
      return;
    }
    try {
      state = { kind: 'ready', resources: build(device, surface.format), completionQueued: false };
    } catch (error) {
      device.destroy();
      throw error;
    }
    const current = state;
    void device.lost.then(() => {
      if (state === current) unavailable();
    });
    schedule();
  }
  void initialize();

  return {
    get status() { return state.kind; },
    update(next: RenderInput): void {
      if (state.kind === 'disposed' || state.kind === 'unavailable') return;
      const wasRunning = input.visible && input.animate;
      input = next;
      fabric.update(input.palette, input.animate, state.kind === 'ready' && state.completionQueued, clock.now());
      if (!input.visible || input.width <= 0 || input.height <= 0 || (wasRunning && !input.animate)) stop();
      schedule();
    },
    dispose(): void {
      if (state.kind === 'disposed') return;
      release();
      state = { kind: 'disposed' };
    },
  };
}
