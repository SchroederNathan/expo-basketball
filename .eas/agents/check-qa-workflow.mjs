import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = Bun.YAML.parse(await readFile('.eas/workflows/qa-swarm.yml', 'utf8'));
const baseline = Bun.YAML.parse(await readFile('.eas/workflows/agentic-ci-ios.yml', 'utf8'));
const jobs = workflow.jobs;
assert.deepEqual(workflow.concurrency, { group: 'codex-subscription-agentic-ios', queue: 'max', cancel_in_progress: false });
assert.equal(workflow.permissions.account.role, 'developer');
assert.equal(workflow.defaults.tools.bun, '1.2.22');
assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
for (const input of ['repository', 'target_ref', 'candidate_sha']) assert.equal(workflow.on.workflow_dispatch.inputs[input].required, true);
for (const job of ['fingerprint', 'get_build', 'build', 'repack']) assert.deepEqual(jobs[job], baseline.jobs[job]);
assert.deepEqual(jobs.swarm.needs, ['preflight', 'fingerprint', 'get_build']);
assert.deepEqual(jobs.swarm.after, ['build', 'repack']);
assert.equal(jobs.swarm.env.AGENT_SOURCE_SHA, '${{ inputs.candidate_sha }}');
assert.equal(jobs.swarm.env.AGENT_BUILD_ID, '${{ after.build.outputs.build_id || after.repack.outputs.build_id }}');
assert.equal(jobs.swarm.env.AGENT_NATIVE_SOURCE_BUILD_ID, "${{ needs.get_build.outputs.build_id || '' }}");
assert.equal(jobs.swarm.env.AGENT_NATIVE_SOURCE_SHA, "${{ needs.get_build.outputs.git_commit_hash || '' }}");
assert.equal(jobs.swarm.steps.at(-1).if, '${{ always() }}');
assert.equal(jobs.swarm.steps.at(-1).with.path, 'agent-output/qa/public/**/*');
assert.equal(jobs.result.if, "${{ after.swarm.outputs.state != 'PASS' }}");
assert.deepEqual(jobs.result.after, ['preflight', 'fingerprint', 'get_build', 'build', 'repack', 'swarm']);
assert.equal(jobs.swarm.steps.filter((step) => step.run?.includes('bun .eas/agents/qa-swarm.ts run')).length, 1);
for (const job of Object.values(jobs)) {
  for (const dependency of [...(job.needs ?? []), ...(job.after ?? [])]) assert.ok(jobs[dependency]);
}
process.stdout.write('QA uses the reviewed native graph, one serialized subscription job, and a fail-closed result gate.\n');

const probe = Bun.YAML.parse(await readFile('.eas/workflows/codex-concurrency-probe.yml', 'utf8'));
assert.deepEqual(probe.concurrency, workflow.concurrency);
assert.equal(probe.permissions.account.role, 'developer');
assert.equal(probe.defaults.tools.bun, '1.2.22');
assert.deepEqual(Object.keys(probe.on), ['workflow_dispatch']);
for (const input of ['repository', 'target_ref', 'candidate_sha']) assert.equal(probe.on.workflow_dispatch.inputs[input].required, true);
assert.equal(probe.jobs.probe.environment, 'preview');
assert.equal(probe.jobs.probe.env.AGENT_SOURCE_SHA, '${{ inputs.candidate_sha }}');
assert.equal(probe.jobs.probe.steps.at(-1).if, '${{ always() }}');
assert.equal(probe.jobs.probe.steps.at(-1).with.path, 'agent-output/probe/public/**/*');
assert.ok(probe.jobs.probe.steps.some((step) => step.run === 'bun .eas/agents/qa-swarm.ts preflight'));
assert.ok(probe.jobs.probe.steps.some((step) => step.run?.includes('bun .eas/agents/codex-probe.ts agent-output/probe/public/result.json')));
