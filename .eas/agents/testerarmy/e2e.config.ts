import type { E2EConfig } from 'e2e';
import { chatgpt } from 'e2e/oauth/chatgpt';
import { mobile } from '@e2e-dev/mobile';
import { easSimulators } from '@e2e-dev/eas';
import { runtimeContext } from './context';
import { ownedProvider, projectId } from './provider';

const context = runtimeContext();
export default {
  projectId: 'lob-testerarmy', tests: 'tests/jordan.e2e.ts', output: 'output',
  targets: [{ name: 'ios', app: { bundleId: 'dev.expo.basketball' }, video: 'on', trace: 'on',
    engine: mobile({ platform: 'ios', videoTouches: false,
      device: ownedProvider(easSimulators({ projectId, buildId: context.target.native.installed,
        maxDurationMinutes: 30, maxIdleTimeMinutes: 10, tags: [`lob-testerarmy-${context.attemptId}`] }),
      { attemptId: context.attemptId, ledgerFile: context.ledgerFile }),
    }),
  }],
  agents: { default: { model: chatgpt('gpt-6.1-sol'), providerOptions: { openai: { reasoningEffort: 'xhigh' } },
    maxSteps: 20, maxModelCalls: 20,
    context: 'Navigate the installed synthetic NBA app only. Use semantic controls. Do not manage sessions, credentials, files, or publication. Assertions in the test judge the app.',
  } },
  workers: 1, retries: 0, timeout: 900_000, maxDuration: 900_000, launchTimeout: 120_000,
  actionTimeout: 30_000, assertionTimeout: 10_000, cleanupTimeout: 120_000,
  cache: context.cache,
  reporters: [],
} satisfies E2EConfig;
