// A null period means every period ("All").
type Chip = { readonly period: number | null };

export type PeriodChoice =
  | { readonly kind: 'latest' }
  | { readonly kind: 'all' }
  | { readonly kind: 'period'; readonly period: number };

export function latestPeriod(chips: readonly Chip[]): number | null {
  let latest: number | null = null;
  for (const chip of chips) {
    if (chip.period !== null && (latest === null || chip.period > latest)) latest = chip.period;
  }
  return latest;
}

export function resolvePeriod(chips: readonly Chip[], choice: PeriodChoice): number | null {
  switch (choice.kind) {
    case 'latest':
      return latestPeriod(chips);
    case 'all':
      return null;
    case 'period':
      return chips.some((chip) => chip.period === choice.period)
        ? choice.period
        : latestPeriod(chips);
    default: {
      const exhaustive: never = choice;
      return exhaustive;
    }
  }
}

export function playsInPeriod<T extends { readonly period: number }>(
  plays: readonly T[],
  period: number | null,
): readonly T[] {
  return period === null ? plays : plays.filter((play) => play.period === period);
}
