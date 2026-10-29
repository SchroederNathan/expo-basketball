import fixture from '../../demo/fixtures/prizepicks-v1.json';
import { parseYmd, parseZone } from '@/domain/dates';

export function demoEnabled(value: string | undefined): boolean {
  if (value === undefined || value === '') return false;
  if (value === fixture.id) return true;
  throw new Error('Unknown demo fixture. Live API fallback is disabled.');
}

export const DEMO_ENABLED = demoEnabled(process.env.EXPO_PUBLIC_AGENT_DEMO);

const today = parseYmd(fixture.date);
const zone = parseZone(fixture.zone);
if (today === null || zone === null) throw new Error('Invalid demo calendar.');
export const DEMO_CALENDAR = { today, zone };
