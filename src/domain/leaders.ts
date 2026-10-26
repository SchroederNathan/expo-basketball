export const LEADER_STATS = ['points', 'rebounds', 'assists', 'steals', 'blocks', 'threes'] as const;

export type LeaderStat = (typeof LEADER_STATS)[number];

export const LEADER_STAT_LABELS: Readonly<Record<LeaderStat, string>> = {
  points: 'PPG',
  rebounds: 'RPG',
  assists: 'APG',
  steals: 'SPG',
  blocks: 'BPG',
  threes: '3PM',
};

export const DEFAULT_LEADER_STAT: LeaderStat = 'points';
