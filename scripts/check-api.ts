/// <reference types="node" />
// Requests the live basketball API once per route and parses each answer with
// the app's own schemas. Run: node --import tsx scripts/check-api.ts
import {
  fetchGame,
  fetchLeaders,
  fetchPlayer,
  fetchPlays,
  fetchScoreboard,
  fetchSearch,
  fetchStandings,
  fetchTeam,
  fetchTeams,
} from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { Scoreboard } from '@/api/schemas';
import { parseZone, todayIn } from '@/domain/dates';
import { isGameId, type GameRef } from '@/domain/ids';
import { LEAGUE_IDS } from '@/domain/league';
import { standingsViews } from '@/domain/standings';
import { toSearchQuery } from '@/domain/search';

// A completed NBA game with a full box score and play-by-play, used when the
// current day has no final game yet.
const KNOWN_FINAL_GAME_ID = '401909861';

let failures = 0;

function report(status: 'ok' | 'FAIL', label: string, detail: string): void {
  process.stdout.write(`${status.padEnd(4)} ${label.padEnd(34)} ${detail}\n`);
}

async function check<T>(label: string, task: () => Promise<T>, describe: (value: T) => string): Promise<T | null> {
  try {
    const value = await task();
    report('ok', label, describe(value));
    return value;
  } catch (error) {
    failures += 1;
    const detail =
      error instanceof ApiError
        ? `${error.kind}${error.status === null ? '' : ` ${error.status}`}${error.issuePath ? ` at ${error.issuePath}` : ''}: ${error.message}`
        : String(error);
    report('FAIL', label, detail);
    return null;
  }
}

function countStates(board: Scoreboard): string {
  const counts = { pre: 0, in: 0, post: 0 };
  for (const game of board.games) counts[game.state] += 1;
  return `${board.games.length} games (${counts.pre} pre, ${counts.in} live, ${counts.post} final), poll ${board.pollSeconds}s`;
}

async function main(): Promise<void> {
  const zone = parseZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? parseZone('America/New_York');
  if (zone === null) throw new Error('No usable time zone in this runtime.');
  const date = todayIn(zone, new Date());
  process.stdout.write(`Checking the basketball API for ${date} in ${zone}\n`);

  const boards = new Map<string, Scoreboard>();
  for (const league of LEAGUE_IDS) {
    const board = await check(`${league} scoreboard`, () => fetchScoreboard({ league, date, zone }), countStates);
    if (board) boards.set(league, board);
  }

  const todayFinal = boards.get('nba')?.games.find((game) => game.state === 'post')?.id;
  const finalId = todayFinal ?? KNOWN_FINAL_GAME_ID;
  if (!isGameId(finalId)) throw new Error(`Invalid game id ${finalId}`);
  const game: GameRef = { league: 'nba', id: finalId };

  const detail = await check(`nba game ${game.id}`, () => fetchGame({ ref: game, zone }), (value) =>
    [
      `${value.game.away.abbr} ${value.game.away.score}–${value.game.home.score} ${value.game.home.abbr} ${value.game.status}`,
      `${value.box.length} box teams`,
      `${value.leaders.length} leaders`,
      `${value.periods.length} period chips`,
      `${value.standings.groups.length} standings groups`,
      value.flow.empty ? 'no flow' : 'flow',
    ].join(', '),
  );
  await check(`nba plays ${game.id}`, () => fetchPlays({ ref: game }), (feed) => {
    const dividers = feed.plays.filter((play) => play.kind === 'divider').length;
    return `${feed.plays.length} items (${feed.plays.length - dividers} plays, ${dividers} dividers)`;
  });

  const standings = await check('nba standings', () => fetchStandings({ league: 'nba', zone }), (table) =>
    `${table.season}: ${standingsViews(table)
      .map((view) => view.label)
      .join(' / ')}`,
  );
  const teams = await check('nba teams', () => fetchTeams({ league: 'nba' }), (index) =>
    `${index.teams.length} teams in ${index.groups.length} groups`,
  );

  const teamId = detail?.game.away.id ?? teams?.teams[0]?.id ?? standings?.conferences[0]?.rows[0]?.teamId ?? null;
  if (teamId !== null) {
    await check(`nba team ${teamId}`, () => fetchTeam({ ref: { league: 'nba', id: teamId }, zone }), (page) =>
      `${page.team.fullName} ${page.team.record}: ${page.roster.length} roster, ${page.results.length} results, ${page.upcoming.length} upcoming`,
    );
  } else {
    failures += 1;
    report('FAIL', 'nba team', 'no team id was available from earlier answers');
  }

  const leaders = await check('nba leaders points', () => fetchLeaders({ league: 'nba', stat: 'points' }), (value) =>
    `${value.season} ${value.label}: ${value.players.length} players`,
  );
  const playerId = leaders?.players[0]?.id ?? null;
  if (playerId !== null) {
    await check(`nba player ${playerId}`, () => fetchPlayer({ ref: { league: 'nba', id: playerId }, zone }), (page) =>
      `${page.player.name}: ${page.player.stats.length} season stats, ${page.games.length} recent games`,
    );
  } else {
    failures += 1;
    report('FAIL', 'nba player', 'no player id was available from the leaders answer');
  }

  const query = toSearchQuery('curry');
  if (query === null) throw new Error('The search query is invalid.');
  await check('nba search "curry"', () => fetchSearch({ league: 'nba', query }), (results) =>
    `${results.results.length} results: ${results.results.map((hit) => `${hit.type} ${hit.name}`).join(', ')}`,
  );

  for (const league of LEAGUE_IDS.filter((value) => value !== 'nba')) {
    await check(`${league} standings`, () => fetchStandings({ league, zone }), (table) =>
      `${table.conferences.length} conferences, ${table.divisions.length} divisions`,
    );
    const index = await check(`${league} teams`, () => fetchTeams({ league }), (value) =>
      `${value.teams.length} teams in ${value.groups.length} groups`,
    );
    const team = index?.teams[0];
    if (team) {
      await check(`${league} team ${team.id}`, () => fetchTeam({ ref: { league, id: team.id }, zone }), (page) =>
        `${page.team.fullName}: ${page.roster.length} roster, ${page.results.length} results, ${page.upcoming.length} upcoming`,
      );
    }
  }

  process.stdout.write(failures === 0 ? 'All API checks passed.\n' : `${failures} API check(s) failed.\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
