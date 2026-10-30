import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defineEngine, resolveExpression } from 'e2e/engine';

export function offlineEngine() {
  let page = 0, directory, startedAt, sequence = 0;
  const node = (id, name, extra = {}) => ({ ref: { id, revision: 'offline' }, role: 'text', name,
    rect: { x: 0, y: 0, width: 200, height: 30 }, ...extra });
  const tree = () => {
    const children = [node('identity', process.env.FAKE_IDENTITY), node('next', 'Navigate next', { role: 'button' })];
    if (page === 1) children.push(node('name', process.env.FAKE_MODE === 'wrong-player' ? 'Other player' : 'Jordan Vale'),
      node('reb', 'REB 7.0, ranked 1st'), node('pts', process.env.FAKE_MODE === 'seed' ? '18.5, ranked 3rd' : 'PTS 18.5, ranked 3rd'),
      ...(process.env.FAKE_MODE === 'omitted' ? [] : [node('unknown', process.env.FAKE_UNKNOWN_LABEL ?? (process.env.FAKE_MODE === 'seed' ? '4.2' : 'Stat 4.2'))]));
    if (page === 2) children.push(node('query', 'Teams and players', { role: 'searchbox', value: 'Jordan', attributes: { placeholder: 'Teams and players' } }), node('row', 'Jordan Vale, Comets · Guard'));
    if (page === 3) children.push(node('name', 'Avery Stone'), node('team', 'Team: Comets'), node('pts', 'PTS 24.0, ranked 1st'), node('reb', 'REB 6.0, ranked 2nd'), node('ast', 'AST 8.0, ranked 1st'));
    return node('root', 'Synthetic offline screen', { role: 'document', children });
  };
  return defineEngine({ name: 'mobile', version: '0.12.5', spiVersion: 1, platform: 'ios', workers: 1,
    observe: async () => ({ root: tree(), location: `dev.expo.basketball / Screen ${page}`, viewport: { width: 200, height: 300 } }),
    locate: async (expression) => resolveExpression(expression, [tree()]),
    actions: ['tap'], perform: async () => { page = (page + 1) % 4; },
    session: { restart: async () => { page = 0; } },
    startAttempt: async (context) => { directory = context.artifactsDir; sequence = 0; },
    artifacts: {
      screenshot: async (label) => {
        const path = `screenshots/${++sequence}-${label}.png`;
        await mkdir(dirname(join(directory, path)), { recursive: true });
        await copyFile(process.env.FAKE_PNG, join(directory, path));
        return path;
      },
      startVideo: async () => { startedAt = new Date().toISOString(); },
      stopVideo: async () => { await copyFile(process.env.FAKE_VIDEO, join(directory, 'video.mp4')); return [{ path: 'video.mp4', startedAt }]; },
    },
  });
}

export const offlineExecutor = { name: 'synthetic-no-model', version: '1',
  async runStep(context) {
    const observation = await context.observe({ tree: true });
    const target = observation.tree.children.find((node) => node.name === 'Navigate next');
    await context.actions.tap({ id: target.id });
    await context.observe();
    return { status: 'passed', summary: 'Synthetic navigation completed without a model.' };
  },
};
