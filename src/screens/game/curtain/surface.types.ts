import type { RenderInput } from './renderer';

export type SurfaceProps = Readonly<{
  input: RenderInput;
  onReady: () => void;
  onUnavailable: () => void;
}>;
