import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import fingerprintConfig from '../../fingerprint.config.cjs';

const workflow = Bun.YAML.parse(await readFile('.eas/workflows/agentic-ci-ios.yml', 'utf8'));
const profiles = JSON.parse(await readFile('eas.json', 'utf8')).build;
const app = JSON.parse(await readFile('app.json', 'utf8')).expo;
const jobs = workflow.jobs;
assert.ok(workflow.on.workflow_dispatch.inputs.candidate_sha.required);
assert.ok(workflow.on.workflow_dispatch.inputs.target_ref.required);
assert.ok(workflow.on.pull_request.if.includes('head.repo.full_name == github.repository'));
assert.ok(workflow.on.pull_request.if.includes("github.repository == 'SchroederNathan/expo-basketball'"));
assert.equal(workflow.concurrency.group, 'codex-subscription-agentic-ios');
assert.equal(workflow.concurrency.cancel_in_progress, false);
assert.equal(workflow.permissions.account.role, 'developer');
assert.equal(workflow.defaults.tools.bun, '1.2.22');
assert.ok(jobs.fingerprint.needs.includes('preflight'));
assert.ok(jobs.get_build.needs.includes('fingerprint'));
assert.ok(jobs.build.needs.includes('get_build') && jobs.repack.needs.includes('get_build'));
for (const key of ['build', 'repack']) {
  assert.equal(jobs[key].params.profile, 'agent-preview');
  assert.equal(jobs[key].environment, 'preview');
  assert.equal(jobs[key].hooks, undefined);
}
assert.equal(jobs.get_build.params.profile, 'agent-preview');
assert.equal(jobs.get_build.params.simulator, true);
assert.equal(jobs.repack.params.embed_bundle_assets, true);
assert.equal(jobs.fingerprint.env.EXPO_PUBLIC_AGENT_DEMO, profiles['agent-preview'].env.EXPO_PUBLIC_AGENT_DEMO);
assert.equal(profiles['agent-preview'].ios.simulator, true);
assert.equal(profiles['agent-preview'].ios.buildConfiguration, 'Release');
assert.equal(profiles['agent-preview'].developmentClient, false);
assert.equal(profiles['agent-preview'].extends, 'preview');
assert.equal(profiles['agent-preview'].channel, 'agent-preview');
assert.deepEqual(app.runtimeVersion, { policy: 'appVersion' });
assert.ok(jobs.check.after.includes('build') && jobs.check.after.includes('repack'));
assert.equal(jobs.check.steps.at(-1).with.path, 'agent-output/public/**/*');
assert.equal(jobs.result.if, "${{ after.check.outputs.state != 'PASS' }}");
for (const job of Object.values(jobs)) {
  for (const dependency of [...(job.needs ?? []), ...(job.after ?? [])]) assert.ok(jobs[dependency]);
}
const source = { type: 'contents', id: 'expoConfig' };
const one = JSON.stringify({ extra: { agentDemo: { fixtureId: 'prizepicks-v1', sourceSha: 'a'.repeat(40), fixtureSha256: '1'.repeat(64) } }, ios: { bundleIdentifier: 'dev.expo.basketball' } });
const two = one.replace('a'.repeat(40), 'b'.repeat(40));
assert.equal(fingerprintConfig.fileHookTransform(source, one), fingerprintConfig.fileHookTransform(source, two));
const changedNative = two.replace('dev.expo.basketball', 'dev.expo.changed');
assert.notEqual(fingerprintConfig.fileHookTransform(source, one), fingerprintConfig.fileHookTransform(source, changedNative));
assert.notEqual(fingerprintConfig.fileHookTransform(source, one), fingerprintConfig.fileHookTransform(source, one.replace('1'.repeat(64), '2'.repeat(64))));
const normal = JSON.stringify(app);
assert.equal(fingerprintConfig.fileHookTransform(source, normal), normal);
process.stdout.write('Agentic iOS workflow graph, source guards, profile, evidence, and result checks passed.\n');

for (const name of ['agentic-ci-ios', 'bug-triage', 'issue-to-pr']) {
  const configuration = Bun.YAML.parse(await readFile(`.eas/workflows/${name}.yml`, 'utf8'));
  assert.deepEqual(configuration.concurrency, { group: 'codex-subscription-agentic-ios', queue: 'max', cancel_in_progress: false });
  assert.equal(configuration.permissions.account.role, 'developer');
  assert.equal(configuration.defaults.tools.bun, '1.2.22');
  for (const input of ['repository', 'target_ref', 'candidate_sha']) assert.equal(configuration.on.workflow_dispatch.inputs[input].required, true);
  for (const job of Object.values(configuration.jobs)) {
    for (const dependency of [...(job.needs ?? []), ...(job.after ?? [])]) assert.ok(configuration.jobs[dependency]);
    assert.ok(!['submit', 'update'].includes(job.type));
    for (const step of job.steps ?? []) {
      if (step.uses === 'eas/checkout') {
        assert.equal(step.with.fetch_depth, 0);
        assert.equal(step.with.ref, undefined);
      }
    }
  }
  if (name === 'agentic-ci-ios') continue;
  const { jobs } = configuration;
  assert.equal(configuration.on.pull_request, undefined);
  assert.equal(configuration.on.workflow_dispatch.inputs.issue_number.required, true);
  assert.ok(jobs.preflight.outputs.issue_digest && jobs.preflight.outputs.criteria_sha256);
  const operation = name === 'bug-triage' ? jobs.check : jobs.change;
  assert.equal(operation.env.AGENT_ISSUE_DIGEST, '${{ needs.preflight.outputs.issue_digest }}');
  assert.equal(operation.env.AGENT_CRITERIA_SHA256, '${{ needs.preflight.outputs.criteria_sha256 }}');
  assert.equal(operation.steps.at(-1).if, '${{ always() }}');
  assert.equal(operation.steps.at(-1).with.path, 'agent-output/public/**/*');
  assert.ok(jobs.result.after.includes(name === 'bug-triage' ? 'check' : 'change'));
  if (name === 'bug-triage') {
    assert.equal(jobs.get_build.params.simulator, true);
    assert.equal(jobs.repack.params.embed_bundle_assets, true);
    assert.equal(jobs.build.params.profile, 'agent-preview');
    assert.equal(jobs.repack.params.profile, 'agent-preview');
    assert.deepEqual(jobs.check.after, ['build', 'repack']);
    assert.ok(jobs.result.if.includes('REPLICATED') && jobs.result.if.includes('NOT_REPLICATED'));
  } else {
    assert.ok(jobs.result.if.includes('PR_READY') && jobs.result.if.includes('NO_CHANGE'));
  }
}
process.stdout.write('All implemented workflows share the subscription queue and freeze issue inputs across jobs.\n');
