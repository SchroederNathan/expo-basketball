import type { PlayerPage } from '@/api/schemas';

export function seasonStatTiles(stats: readonly PlayerPage['player']['stats'][number][]) {
  return stats.map((stat, index) => ({
    ...stat,
    key: `${stat.label}:${index}`,
    accessibilityLabel: `${stat.label} ${stat.value}${stat.rank ? `, ranked ${stat.rank}` : ''}`,
  }));
}
