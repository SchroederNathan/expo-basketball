import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToString } from 'react-dom/server';
import { CurtainSurfaceView } from './surface';

test('the real web surface renders on the server without reading navigator', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, get() { assert.fail('SSR read navigator'); } });
  try {
    const html = renderToString(<CurtainSurfaceView
      input={{ palette: null, animate: false, visible: true, width: 402, height: 688, pixelRatio: 2 }}
      onReady={() => assert.fail('SSR ran a GPU effect')}
      onUnavailable={() => assert.fail('SSR ran an availability effect')}
    />);
    assert.match(html, /<canvas/);
    assert.match(html, /aria-hidden="true"/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
