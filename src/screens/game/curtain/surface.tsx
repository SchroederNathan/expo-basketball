import { useCallback, useRef } from 'react';
import type { CurtainSurface } from './renderer';
import type { SurfaceProps } from './surface.types';
import { useCurtainSurface } from './use-surface';

// Web and SSR deliberately do not import the native module.
export function CurtainSurfaceView(props: SurfaceProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const connect = useCallback((): CurtainSurface | null => {
    const canvas = ref.current;
    if (!canvas || typeof navigator === 'undefined' || !navigator.gpu) return null;
    const context = canvas.getContext('webgpu');
    if (!context) return null;
    return {
      context,
      format: navigator.gpu.getPreferredCanvasFormat(),
      acquire: async () => {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter ? adapter.requestDevice() : null;
      },
      resize: (width, height) => {
        canvas.width = width;
        canvas.height = height;
      },
      present: () => {},
    };
  }, []);
  useCurtainSurface(connect, props);
  return <canvas ref={ref} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}
