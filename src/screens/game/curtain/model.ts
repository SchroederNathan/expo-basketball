export type Palette = Readonly<{ away: string; home: string }>;
type Color = readonly [number, number, number, number];
type Colors = Readonly<{ away: Color; home: Color }>;
type Transition = Readonly<{ from: Colors; to: Colors; started: number }>;

export const CURTAIN_HEIGHT = 688;
export const CURTAIN_TOP = -128;
export const VISIBLE_BOTTOM = CURTAIN_TOP + CURTAIN_HEIGHT * 0.6;
export const INDEX_COUNT = 96 * 164 * 6;

function color(hex: string): Color {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, 1];
}

function mix(from: Color, to: Color, t: number): Color {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
    1,
  ];
}

function at(transition: Transition, now: number): Colors {
  const t = Math.min(1, Math.max(0, (now - transition.started) / 800));
  const blend = t * t * (3 - 2 * t);
  return {
    away: mix(transition.from.away, transition.to.away, blend),
    home: mix(transition.from.home, transition.to.home, blend),
  };
}

export class FabricFrame {
  private target: Palette | null = null;
  private transition: Transition | null = null;
  private animated = false;
  private anchor: number | null = null;
  private elapsed = 0;
  readonly uniforms = new Float32Array(16);

  get hasPalette(): boolean {
    return this.transition !== null;
  }

  update(palette: Palette | null, animated: boolean, ready: boolean, now: number): void {
    if (palette && (palette.away !== this.target?.away || palette.home !== this.target?.home)) {
      const to = { away: color(palette.away), home: color(palette.home) };
      const from = animated && ready && this.transition ? at(this.transition, now) : to;
      this.transition = { from, to, started: now };
      this.target = palette;
    }
    if (animated !== this.animated) this.pause();
    this.animated = animated;
  }

  pause(): void {
    this.anchor = null;
  }

  pack(now: number, width: number, height: number, pointWidth: number): Float32Array<ArrayBuffer> {
    if (this.animated) {
      if (this.anchor !== null) this.elapsed += Math.max(0, now - this.anchor);
      this.anchor = now;
    }
    const u = this.uniforms;
    u[0] = this.elapsed * 0.001;
    u[1] = width;
    u[2] = height;
    u[3] = 0;
    u[4] = pointWidth;
    if (this.transition) {
      const colors = at(this.transition, now);
      u.set(colors.away, 8);
      u.set(colors.home, 12);
    }
    return u;
  }
}

export function gridIndices(): Uint16Array<ArrayBuffer> {
  const indices = new Uint16Array(INDEX_COUNT);
  let offset = 0;
  for (let y = 0; y < 164; y++) {
    for (let x = 0; x < 96; x++) {
      const a = y * 97 + x;
      const b = a + 97;
      indices.set([a, a + 1, b, b, a + 1, b + 1], offset);
      offset += 6;
    }
  }
  return indices;
}

export function leatherBytes(base64: string): Uint8Array<ArrayBuffer> {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((base64.length / 4) * 3 - padding);
  let offset = 0;
  for (let i = 0; i < base64.length; i += 4) {
    const value = (alphabet.indexOf(base64[i]) << 18) | (alphabet.indexOf(base64[i + 1]) << 12)
      | (Math.max(0, alphabet.indexOf(base64[i + 2])) << 6) | Math.max(0, alphabet.indexOf(base64[i + 3]));
    if (offset < bytes.length) bytes[offset++] = (value >> 16) & 255;
    if (offset < bytes.length) bytes[offset++] = (value >> 8) & 255;
    if (offset < bytes.length) bytes[offset++] = value & 255;
  }
  return bytes;
}
