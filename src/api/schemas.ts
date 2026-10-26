import { z } from 'zod';
import { isYmd } from '@/domain/dates';
import { isGameId, isPlayerId, isTeamId, type TeamId } from '@/domain/ids';
import { LEADER_STATS } from '@/domain/leaders';
import { LEAGUE_IDS } from '@/domain/league';

// Display strings fall back to empty, so one odd field never blanks a screen.
// Identity fields are required, and a bad one fails the whole response.
const text = z.string().catch('');
const flag = z.boolean().catch(false);
const count = z.number().catch(0);
const textList = z.array(z.string()).catch([]);
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .catch('#8A8A8A');
// The flow chart paths use only move, line, and close commands with numbers.
const svgPath = z
  .string()
  .regex(/^[MLHVZ0-9.\s-]*$/i)
  .catch('');

const league = z.enum(LEAGUE_IDS);
const gameState = z.enum(['pre', 'in', 'post']);
const ymd = z.string().refine(isYmd, 'Expected a YYYYMMDD date');
const gameId = z.string().refine(isGameId, 'Expected a game id');
const teamId = z.string().refine(isTeamId, 'Expected a team id');
const playerId = z.string().refine(isPlayerId, 'Expected a player id');
// Scheduled participants can be unknown, for example in a tournament bracket.
const optionalTeamId = z
  .string()
  .catch('')
  .transform((value): TeamId | null => (isTeamId(value) ? value : null));

const gameSide = z.object({
  id: optionalTeamId,
  abbr: text,
  name: text,
  fullName: text,
  location: text,
  logo: text,
  color,
  accent: color,
  record: text,
  score: text,
  linescores: textList,
  winner: flag,
  leading: flag,
  rank: text,
});

const game = z.object({
  id: gameId,
  league,
  state: gameState,
  startTime: text,
  status: text,
  detail: text,
  period: count,
  periodLabel: text,
  clock: text,
  regulationPeriods: z.number().int().min(1).max(8).catch(4),
  broadcast: text,
  odds: text,
  venue: text,
  shortName: text,
  away: gameSide,
  home: gameSide,
});

export const scoreboardSchema = z.object({
  league,
  date: ymd,
  dateLabel: text,
  hasLive: flag,
  pollSeconds: count,
  games: z.array(game),
});

const infoLine = z.object({ label: text, value: text });

const standingRow = z.object({
  rank: text,
  teamId,
  abbr: text,
  name: text,
  logo: text,
  record: text,
  wins: count,
  losses: count,
  pct: text,
  gb: text,
  streak: text,
  lastTen: text,
  home: text,
  road: text,
  clinch: text,
  live: flag,
  highlight: flag,
});

const standingGroup = z.object({
  id: z.string().min(1),
  name: text,
  fullName: text,
  kind: z.enum(['conference', 'division']),
  conference: text,
  rows: z.array(standingRow),
});

type PeriodChipShape = { readonly period: number | null; readonly label: string };

const periodChip = z.object({ id: z.string(), label: text }).transform((chip, ctx): PeriodChipShape => {
  if (chip.id === 'all') return { period: null, label: chip.label };
  const period = Number(chip.id);
  if (!Number.isInteger(period) || period < 1) {
    ctx.addIssue({ code: 'custom', message: 'Expected "all" or a period number' });
    return z.NEVER;
  }
  return { period, label: chip.label };
});

const playCommon = {
  id: z.string().min(1),
  period: z.number().int().min(0),
  periodLabel: text,
  clock: text,
  awayScore: text,
  homeScore: text,
  text: text,
};

const play = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('play'),
    ...playCommon,
    teamId: optionalTeamId,
    logo: text,
    assist: text,
    scoring: flag,
    badge: text,
    highlight: flag,
    scoredBy: z
      .enum(['away', 'home', ''])
      .catch('')
      .transform((side) => (side === '' ? null : side)),
  }),
  z.object({ kind: z.literal('divider'), ...playCommon }),
]);

const boxStatFields = {
  min: text,
  pts: text,
  reb: text,
  ast: text,
  stl: text,
  blk: text,
  to: text,
  fg: text,
  tp: text,
  ft: text,
  oreb: text,
  dreb: text,
  pf: text,
  pm: text,
};

const boxPlayer = z.object({
  id: playerId,
  name: text,
  fullName: text,
  position: text,
  jersey: text,
  headshot: text,
  starter: flag,
  onCourt: flag,
  didNotPlay: flag,
  note: text,
  ...boxStatFields,
});

const boxTeam = z.object({
  id: optionalTeamId,
  abbr: text,
  name: text,
  logo: text,
  accent: color,
  starters: z.array(boxPlayer),
  bench: z.array(boxPlayer),
  totals: z.object(boxStatFields),
  stats: z.array(infoLine),
});

export const gameDetailSchema = z.object({
  game,
  linescore: z.object({ labels: textList, away: textList, home: textList }),
  flow: z.object({
    width: z.number().positive().catch(354),
    height: z.number().positive().catch(64),
    grid: svgPath,
    line: svgPath,
    awayArea: svgPath,
    homeArea: svgPath,
    awayColor: color,
    homeColor: color,
    dotX: count,
    dotY: count,
    showDot: flag,
    empty: flag,
  }),
  leaders: z.array(
    z.object({
      id: playerId,
      teamId: optionalTeamId,
      name: text,
      headshot: text,
      line: text,
      accent: color,
    }),
  ),
  box: z.array(boxTeam),
  periods: z.array(periodChip),
  lastPlay: play.nullable().catch(null),
  standings: z.object({ season: text, groups: z.array(standingGroup) }),
  info: z.array(infoLine),
  pollSeconds: count,
});

export const playFeedSchema = z.object({
  gameId,
  state: gameState,
  periods: z.array(periodChip),
  plays: z.array(play),
});

export const standingsSchema = z.object({
  season: text,
  conferences: z.array(standingGroup),
  divisions: z.array(standingGroup),
});

const teamSummary = z.object({
  id: teamId,
  abbr: text,
  name: text,
  fullName: text,
  location: text,
  logo: text,
  color,
  accent: color,
});

export const teamsIndexSchema = z.object({
  teams: z.array(teamSummary),
  groups: z.array(
    z.object({
      id: z.string().min(1),
      name: text,
      conference: text,
      teams: z.array(teamSummary),
    }),
  ),
});

const scheduleGame = z.object({
  id: gameId,
  date: text,
  dateLabel: text,
  state: gameState,
  opponent: z.object({ id: optionalTeamId, abbr: text, name: text, logo: text }),
  atVs: z.enum(['vs', '@']).catch('vs'),
  result: z.enum(['W', 'L', '']).catch(''),
  score: text,
  time: text,
  status: text,
});

export const teamPageSchema = z.object({
  team: z.object({
    id: teamId,
    abbr: text,
    name: text,
    fullName: text,
    logo: text,
    color,
    accent: color,
    record: text,
    home: text,
    road: text,
    standing: text,
  }),
  roster: z.array(
    z.object({
      id: playerId,
      name: text,
      shortName: text,
      jersey: text,
      position: text,
      headshot: text,
      detail: text,
      injury: text,
    }),
  ),
  results: z.array(scheduleGame),
  upcoming: z.array(scheduleGame),
});

export const leadersSchema = z.object({
  stat: z.enum(LEADER_STATS),
  label: text,
  season: text,
  players: z.array(
    z.object({
      rank: text,
      id: playerId,
      name: text,
      shortName: text,
      team: text,
      teamLogo: text,
      position: text,
      headshot: text,
      value: text,
      line: text,
    }),
  ),
});

export const playerPageSchema = z.object({
  player: z.object({
    id: playerId,
    name: text,
    jersey: text,
    position: text,
    headshot: text,
    team: z
      .object({ id: teamId, abbr: text, name: text, logo: text })
      .nullable()
      .catch(null),
    bio: z.array(infoLine),
    season: text,
    stats: z.array(z.object({ label: text, value: text, rank: text })),
  }),
  games: z.array(
    z.object({
      id: gameId,
      date: text,
      dateLabel: text,
      opponent: text,
      opponentLogo: text,
      result: text,
      win: flag,
      min: text,
      pts: text,
      reb: text,
      ast: text,
      fg: text,
    }),
  ),
});

const hitFields = { name: text, image: text, subtitle: text };

export const searchResultsSchema = z.object({
  query: text,
  results: z.array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('team'), id: teamId, ...hitFields }),
      z.object({ type: z.literal('player'), id: playerId, ...hitFields }),
    ]),
  ),
});

export type Scoreboard = z.output<typeof scoreboardSchema>;
export type Game = Scoreboard['games'][number];
export type GameSide = Game['away'];
export type GameState = Game['state'];
export type GameDetail = z.output<typeof gameDetailSchema>;
export type FlowChart = GameDetail['flow'];
export type Linescore = GameDetail['linescore'];
export type GameLeader = GameDetail['leaders'][number];
export type BoxTeam = GameDetail['box'][number];
export type BoxPlayer = BoxTeam['starters'][number];
export type BoxStats = BoxTeam['totals'];
export type PeriodChip = GameDetail['periods'][number];
export type PlayFeed = z.output<typeof playFeedSchema>;
export type Play = PlayFeed['plays'][number];
export type Standings = z.output<typeof standingsSchema>;
export type StandingGroup = Standings['conferences'][number];
export type StandingRow = StandingGroup['rows'][number];
export type TeamsIndex = z.output<typeof teamsIndexSchema>;
export type TeamSummary = TeamsIndex['teams'][number];
export type TeamPage = z.output<typeof teamPageSchema>;
export type ScheduleGame = TeamPage['results'][number];
export type RosterPlayer = TeamPage['roster'][number];
export type Leaders = z.output<typeof leadersSchema>;
export type LeaderRow = Leaders['players'][number];
export type PlayerPage = z.output<typeof playerPageSchema>;
export type GameLogRow = PlayerPage['games'][number];
export type SearchResults = z.output<typeof searchResultsSchema>;
export type SearchHit = SearchResults['results'][number];
