// The API's pollSeconds hint is the only source for refresh cadence. A screen
// polls only while it is focused and its data can still change.
const MIN_POLL_SECONDS = 5;

export type PollInput = {
  readonly pollSeconds: number;
  readonly settled: boolean;
  readonly focused: boolean;
};

export function pollIntervalMs({ pollSeconds, settled, focused }: PollInput): number | false {
  if (!focused || settled) return false;
  if (!Number.isFinite(pollSeconds) || pollSeconds <= 0) return false;
  return Math.max(MIN_POLL_SECONDS, pollSeconds) * 1000;
}

export function isSettledDay(games: readonly { readonly state: 'pre' | 'in' | 'post' }[]): boolean {
  return games.every((game) => game.state === 'post');
}
