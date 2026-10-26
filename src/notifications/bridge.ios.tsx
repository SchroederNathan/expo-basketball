import { lazy, Suspense, useEffect, useState } from 'react';
import { detectPushSupport } from './service';

const EnabledBridge = lazy(() => import('./bridge-enabled').then((module) => ({ default: module.PushResponseBridge })));

export function PushResponseBridge() {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let active = true;
    void detectPushSupport().then((support) => {
      if (active) setSupported(support.kind === 'supported');
    });
    return () => { active = false; };
  }, []);
  return supported ? <Suspense fallback={null}><EnabledBridge /></Suspense> : null;
}
