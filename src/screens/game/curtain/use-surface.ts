import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { mountCurtain, type CurtainSurface } from './renderer';
import type { SurfaceProps } from './surface.types';

export function useCurtainSurface(connect: () => CurtainSurface | null, { input, onReady, onUnavailable }: SurfaceProps): void {
  const owner = useRef<ReturnType<typeof mountCurtain> | null>(null);
  const latest = useEffectEvent(() => ({ input, onReady, onUnavailable }));
  const usable = input.width > 0 && input.height > 0;
  const [hasLayout, setHasLayout] = useState(usable);
  if (usable && !hasLayout) setHasLayout(true);
  useEffect(() => {
    if (!hasLayout) return;
    const surface = connect();
    if (!surface) {
      latest().onUnavailable();
      return;
    }
    const renderer = mountCurtain(surface, latest().input, () => latest().onReady(), () => latest().onUnavailable());
    owner.current = renderer;
    return () => {
      owner.current = null;
      renderer.dispose();
    };
  }, [connect, hasLayout]);
  useEffect(() => owner.current?.update(input), [input]);
}
