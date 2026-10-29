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
for (const key of ['observed_state', 'publication_state', 'publication_url']) assert.ok(jobs.swarm.outputs[key]);
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

const toolsProbe = Bun.YAML.parse(await readFile('.eas/workflows/qa-tools-probe.yml', 'utf8'));
assert.deepEqual(toolsProbe.concurrency, workflow.concurrency);
assert.equal(toolsProbe.permissions.account.role, 'developer');
assert.equal(toolsProbe.defaults.tools.bun, '1.2.22');
assert.deepEqual(Object.keys(toolsProbe.on), ['workflow_dispatch']);
for (const input of ['repository', 'target_ref', 'candidate_sha']) assert.equal(toolsProbe.on.workflow_dispatch.inputs[input].required, true);
assert.deepEqual(Object.keys(toolsProbe.jobs), ['probe']);
assert.equal(toolsProbe.jobs.probe.environment, 'preview');
assert.equal(toolsProbe.jobs.probe.env.AGENT_SOURCE_SHA, '${{ inputs.candidate_sha }}');
assert.ok(toolsProbe.jobs.probe.steps.some((step) => step.run?.includes('bun .eas/agents/qa-tools-probe.ts')));
const upload = toolsProbe.jobs.probe.steps.find((step) => step.uses === 'eas/upload_artifact');
assert.equal(upload.if, '${{ always() }}');
assert.equal(upload.with.path, 'agent-output/qa-tools/public/**/*');
const gate = toolsProbe.jobs.probe.steps.at(-1);
assert.equal(gate.if, '${{ always() }}');
assert.ok(gate.run.includes('r.status !== "PASS"'));
assert.ok(gate.run.includes('r.platform !== "linux"'));
for (const name of ['qa-swarm.ts', 'qa-lanes.ts', 'qa-tools.ts']) {
  const source = await readFile(`.eas/agents/${name}`, 'utf8');
  assert.ok(!/file:\s*['"](?:bunx|npx)['"]/.test(source), `${name} cannot resolve tools at runtime.`);
  assert.ok(!/(?:Use only|Read) (?:bunx|npx)\b/.test(source), `${name} cannot tell model shells to resolve tools.`);
}
