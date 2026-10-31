import { useCallback, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, type CanvasRef } from 'react-native-webgpu';
import type { CurtainSurface } from './renderer';
import type { SurfaceProps } from './surface.types';
import { useCurtainSurface } from './use-surface';

export function CurtainSurfaceView(props: SurfaceProps) {
  const ref = useRef<CanvasRef>(null);
  const connect = useCallback((): CurtainSurface | null => {
    const context = ref.current?.getContext('webgpu');
    if (!context) return null;
    return {
      context,
      format: navigator.gpu.getPreferredCanvasFormat(),
      acquire: async () => {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter ? adapter.requestDevice() : null;
      },
      resize: (width, height) => {
        context.canvas.width = width;
        context.canvas.height = height;
      },
      present: () => context.present(),
    };
  }, []);
  useCurtainSurface(connect, props);
  return <Canvas ref={ref} style={StyleSheet.absoluteFill} android={{ backingView: 'TextureView' }} />;
}
