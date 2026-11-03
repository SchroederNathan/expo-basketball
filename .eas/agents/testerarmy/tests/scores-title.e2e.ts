import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { runtimeContext, identityLabel } from '../context';

const identity = identityLabel(runtimeContext().target);
const actOptions = { maxSteps: 20, maxModelCalls: 20, timeout: 180_000 };

// iOS names the navigation bar after its title, so the bar's id is the title.
test('Scores title acceptance', async ({ app, agent, device, screen }) => {
  await app.open();
  await expect(screen.getByLabel(identity, { exact: true })).toBeVisible();
  await expect(screen.getByLabel('Today, Monday, October 26', { exact: true })).toBeVisible();
  await app.screenshot('controller-start');

  try {
    await expect.soft(device.locator('role=navigation-bar id=Scores')).toBeVisible();
    await expect.soft(screen.getByText('Oct 26', { exact: true })).toHaveCount(0);
  } finally { await app.screenshot('scores-title'); }

  await agent.act('In the date strip under the header, tap Sunday, October 25.', actOptions);
  await expect(screen.getByLabel('Sunday, October 25', { exact: true })).toBeVisible();
  try {
    await expect.soft(device.locator('role=navigation-bar id=Scores')).toBeVisible();
    await expect.soft(screen.getByText('Oct 25', { exact: true })).toHaveCount(0);
  } finally { await app.screenshot('other-day'); }

  await agent.act('Tap the Today control to return to today\'s scores.', actOptions);
  await expect(screen.getByLabel('Today, Monday, October 26', { exact: true })).toBeVisible();
  try {
    for (const text of ['Orbits', 'Comets', '100', '108', 'Final']) {
      await expect.soft(screen.getByText(text, { exact: true }).first()).toBeVisible();
    }
  } finally { await app.screenshot('today-scores'); }

  await expect(screen.getByLabel(identity, { exact: true })).toBeVisible();
  await app.screenshot('controller-end');
});
