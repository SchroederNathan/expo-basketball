import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Text } from 'react-native';
import { z } from 'zod';
import { DEMO_ENABLED } from './config';

const identitySchema = z.strictObject({
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  fixtureId: z.literal('prizepicks-v1'),
  fixtureSha256: z.string().regex(/^[a-f0-9]{64}$/),
  runtime: z.string().min(1),
});

export function DemoIdentity() {
  if (!DEMO_ENABLED) return null;
  const identity = identitySchema.parse(Constants.expoConfig?.extra?.agentDemo);
  const bundle = Updates.isEmbeddedLaunch ? 'embedded' : 'unverified';
  const runtime = Updates.runtimeVersion ?? 'unverified';
  const label = `Lob demo ${identity.fixtureId} source=${identity.sourceSha} fixture=${identity.fixtureSha256} runtime=${runtime} bundle=${bundle}`;
  return (
    <Text accessible accessibilityLabel={label} pointerEvents="none"
      style={{ color: '#FFFFFF', backgroundColor: '#252525', textAlign: 'center', fontSize: 10, padding: 3 }}>
      {`Demo · ${identity.fixtureId} · ${identity.sourceSha.slice(0, 8)} · ${bundle}`}
    </Text>
  );
}
