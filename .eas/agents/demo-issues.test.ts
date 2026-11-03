import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { demoIssueByCriteria, demoIssueKey, demoIssueKeys, demoIssues, demoMarker } from './demo-issues';
import { digest, verdictSchemaFor } from './result';
import { stopReport } from './stop-report';

const root = join(import.meta.dirname, '../..');

test('exactly one known marker selects the demo issue', () => {
  assert.equal(demoIssueKey(`${demoMarker('scores-title')}\nThe title repeats the date.`), 'scores-title');
  assert.equal(demoIssueKey(`${demoMarker('player-label')}\n${demoMarker('player-label')}`), 'player-label');
  for (const body of ['No marker', '<!-- lob-demo:unknown-bug -->', `${demoMarker('player-label')}\n${demoMarker('scores-title')}`, '<!-- lob-demo: -->']) {
    assert.equal(demoIssueKey(body), null);
  }
});

test('each entry pins its criteria bytes, prompt, and e2e test file', async () => {
  for (const key of demoIssueKeys) {
    const entry = demoIssues[key];
    assert.equal(digest(await readFile(join(root, entry.criteria))), entry.criteriaSha256);
    await readFile(join(root, entry.devicePrompt));
    await readFile(join(root, '.eas/agents/testerarmy', entry.e2e.file));
    assert.equal(new Set(entry.deviceChecks).size, entry.deviceChecks.length);
    assert.deepEqual([...entry.e2e.checks].sort(), [...entry.deviceChecks].sort());
    assert.equal(demoIssueByCriteria(entry.criteria), entry);
  }
  assert.throws(() => demoIssueByCriteria('demo/issues/other.md'));
});

test('the device verdict schema follows the issue criteria', () => {
  const checks = demoIssues['scores-title'].deviceChecks.map((id) => ({ id, state: 'PASS', detail: 'Observed.', screenshot: `${id}.png` }));
  const schema = verdictSchemaFor({ path: 'demo/issues/scores-title.md' });
  assert.equal(schema.parse({ state: 'PASS', checks }).state, 'PASS');
  assert.throws(() => verdictSchemaFor({ path: 'demo/issues/player-label.md' }).parse({ state: 'PASS', checks }));
  assert.throws(() => schema.parse({ state: 'PASS', checks: checks.slice(1) }));
});

test('a stopped e2e run names its own workflow', () => {
  const report = stopReport('Frozen acceptance issue is required.', {}, 'E2E iOS');
  assert.match(report, /^### ⚪ E2E iOS: not run/);
  assert.match(report, /no frozen issue acceptance receipt/);
});
