import { createRoot } from 'react-dom/client';
import { CurtainSurfaceView } from '../../src/screens/game/curtain/surface';

export async function checkUnsupportedWeb(): Promise<string> {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'gpu');
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await new Promise<void>((resolve, reject) => {
      root.render(<CurtainSurfaceView
        input={{ palette: { away: '#FF0000', home: '#0000FF' }, animate: true, visible: true, width: 402, height: 688, pixelRatio: 1 }}
        onReady={() => reject(new Error('Unsupported web revealed a GPU frame.'))}
        onUnavailable={resolve}
      />);
    });
    if (!container.querySelector('canvas')) throw new Error('The web surface did not remain mounted for fallback.');
    return 'Real React web surface without navigator.gpu selects fallback without importing the native module.';
  } finally {
    root.unmount();
    container.remove();
    if (descriptor) Object.defineProperty(navigator, 'gpu', descriptor);
    else Reflect.deleteProperty(navigator, 'gpu');
  }
}
