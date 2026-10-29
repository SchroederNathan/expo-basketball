import { z } from 'zod';

export const laneIds = ['scores', 'current-player', 'search-back'] as const;
export type LaneId = typeof laneIds[number];
export const laneVerdictSchema = z.strictObject({
  id: z.enum(laneIds), state: z.enum(['PASS', 'FAIL', 'BLOCKED']),
  detail: z.string().min(1).max(2000), screenshot: z.enum(['scores.png', 'current-player.png', 'search-back.png']),
}).superRefine((value, context) => {
  if (value.screenshot !== `${value.id}.png`) context.addIssue({ code: 'custom', message: 'Screenshot must belong to this lane.' });
});
export type LaneVerdict = z.infer<typeof laneVerdictSchema>;

export const laneCriteria: Record<LaneId, string> = {
  scores: 'On NBA Scores, verify the fixed October 26, 2026 date, Orbits 100, Comets 108, and Final. Open the game and verify the same result and Avery Stone in its leaders. Capture scores.png on the game detail screen. Return to Scores.',
  'current-player': 'Go to Search and search Avery. Open Avery Stone. Verify PTS 24.0, REB 6.0, AST 8.0 and their meaningful accessibility labels. Capture current-player.png on the profile. Return with Back and then return to Scores.',
  'search-back': 'Go to Search and search Jordan. Open Jordan Vale and verify his name and game log. Return with Back. Verify the Jordan query and Jordan Vale remain in the results. Capture search-back.png on those results and return to Scores. Historical and unknown stat labels seed a separate bug exercise. Do not assert they are fixed.',
};

export function lanePrompt(lane: LaneId, session: string, identity: string, deviceExecutable: string) {
  const executable = `'${deviceExecutable.replaceAll("'", "'\\''")}'`;
  return `Check the installed Lob app on your owned remote iOS session. It is already open and recording.
Use only ${executable} <command> --platform ios --session ${session}.
Read ${executable} help workflow if syntax is unclear. Use fresh snapshot refs for taps, never guessed coordinates.
The executable is already prepared. Do not install or update packages or use bunx, npx, or package-manager run commands.
The shell environment already carries this lane's remote connection. Do not print or inspect connection variables or credentials.
Control only this device. Do not start or stop sessions or recordings, edit code, use GitHub, publish updates, or spawn agents.
Save your screenshot under AGENT_EVIDENCE_DIR. Never manufacture or copy evidence.
The fixture is prizepicks-v1, date 20261026, timezone America/Toronto.
The required installed identity is ${identity}.
Perform only check ${lane}. ${laneCriteria[lane]}
Wait for named content after search debounce. Return to Scores when done so the controller can independently check the identity and final screen.
Return only the required JSON object for this lane. Use FAIL for observed acceptance failures and BLOCKED for unavailable UI or missing evidence.
A successful command or an expectation copied from this prompt is not a passing observation.`;
}
