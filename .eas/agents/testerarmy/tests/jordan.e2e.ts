import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { runtimeContext, identityLabel } from '../context';

const identity = identityLabel(runtimeContext().target);
const actOptions = { maxSteps: 20, maxModelCalls: 20, timeout: 180_000 };

test('Jordan original acceptance', async ({ app, agent, screen }) => {
  await app.open();
  await expect(screen.getByLabel(identity, { exact: true })).toBeVisible();
  await app.screenshot('controller-start');

  await agent.act('Open NBA search, enter the exact query Jordan with a capital J, and open Jordan Vale.', actOptions);
  await expect(screen.getByText('Jordan Vale', { exact: true }).first()).toBeVisible();
  await expect(screen.getByLabel('REB 7.0, ranked 1st', { exact: true })).toBeVisible();
  await app.screenshot('jordan-open');

  try { await expect.soft(screen.getByLabel('PTS 18.5, ranked 3rd', { exact: true })).toBeVisible(); }
  finally { await app.screenshot('historical-points'); }

  try {
    await expect.soft(screen.getByLabel(/^\s*4\.2(?:\s*,.*)?\s*$/)).toHaveCount(0);
    expect.soft(await screen.getByLabel(/(?:^|\s)4\.2(?:\s*,.*)?\s*$/).count()).toBeLessThanOrEqual(1);
  } finally { await app.screenshot('unknown-stat'); }

  await agent.act('Go back to the Jordan search results.', actOptions);
  await expect(screen.getByPlaceholder('Teams and players', { exact: true })).toBeVisible();
  await app.screenshot('search-open');
  try {
    await expect.soft(screen.getByPlaceholder('Teams and players', { exact: true })).toHaveValue('Jordan');
    await expect.soft(screen.getByLabel('Jordan Vale, Comets · Guard', { exact: true })).toBeVisible();
  } finally { await app.screenshot('search-back'); }

  await agent.act('In NBA search, replace the query with Avery and open Avery Stone.', actOptions);
  await expect(screen.getByText('Avery Stone', { exact: true }).first()).toBeVisible();
  await expect(screen.getByLabel('Team: Comets', { exact: true })).toBeVisible();
  await app.screenshot('avery-open');
  try {
    await expect.soft(screen.getByLabel('PTS 24.0, ranked 1st', { exact: true })).toBeVisible();
    await expect.soft(screen.getByLabel('REB 6.0, ranked 2nd', { exact: true })).toBeVisible();
    await expect.soft(screen.getByLabel('AST 8.0, ranked 1st', { exact: true })).toBeVisible();
  } finally { await app.screenshot('current-player'); }

  await agent.act('Return to Scores with Orbits 100 and Comets 108 visible.', actOptions);
  await expect(screen.getByLabel(identity, { exact: true })).toBeVisible();
  await app.screenshot('controller-end');
});
