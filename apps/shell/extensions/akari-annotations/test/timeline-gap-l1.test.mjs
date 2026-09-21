import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createFixture } from '../evidence/timeline-gap-generate/gen-fixture.mjs';
const runner = readFileSync(new URL('../evidence/timeline-gap-generate/l1-timeline-gap-generate.mjs', import.meta.url), 'utf8');
test('L1 fixture copies project-default, produces two real videos and passes edit-lint without Electron', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akari-gap-fixture-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project'), { edit } = await createFixture(project);
  assert.ok((await readFile(join(project, 'AGENTS.md'), 'utf8')).length > 0);
  assert.equal(edit.tracks[0].items[0].duration, 90); assert.equal(edit.tracks[0].items[1].at, 210);
  const lint = new URL('../../../../../packages/edit-lint/bin/edit-lint.mjs', import.meta.url);
  const { stdout } = await promisify(execFile)(process.execPath, [lint.pathname, project, '--json']);
  assert.equal(JSON.parse(stdout).verdict, 'pass');
});
test('L1 uses isolated roots, fake CLI, real mouse clicks, screenshots and layout checks', () => {
  assert.match(runner, /AKARI_HOME:path.join\(ISO/); assert.match(runner, /THEIA_CONFIG_DIR:path.join\(ISO/);
  assert.match(runner, /--user-data-dir=/); assert.match(runner, /AKARI_GENERATE_CLI:fakeCli/);
  assert.match(runner, /await realClick\(cdp,point.x,point.y\)/);
  assert.ok(new Set(runner.match(/\d\d-[a-z-]+\.png/g)).size >= 4);
  assert.match(runner, /gap.button.painted/); assert.match(runner, /overlapPairs\(gap.rects\)/);
  assert.match(runner, /assert.equal\(calls.length,0\)/);
  assert.doesNotMatch(runner, /commitGapFrame\(|selectGapAt\(/);
});
test('L1 browser measurement expressions are valid JavaScript', () => {
  const code = runner.slice(runner.indexOf('const GEOMETRY ='), runner.indexOf('async function listOwnedProcesses()'));
  const expressions = new Function(`${code};return [GAP,GENERATION];`)();
  for (const expression of expressions) assert.doesNotThrow(() => new Function(expression));
});

const statusCode = runner.slice(runner.indexOf('const LINK_STEP ='), runner.indexOf('async function shot('));
const { LINK_STEP, measurementStatus } = new Function(`${statusCode};return {LINK_STEP,measurementStatus};`)();
for (const [name, observed, otherPass, expected] of [
  ['only link missing', false, true, 'pass-except-link'],
  ['link also observed but excluded from the verdict', true, true, 'pass-except-link'],
  ['link and another check fail', false, false, 'fail'],
  ['another check fails even with link', true, false, 'fail'],
  ['link not measured', undefined, true, 'fail']
]) test(`L1 final status: ${name}`, () => {
  assert.equal(measurementStatus({ steps: [{ name: LINK_STEP, pass: observed === true }, { name: 'edit-lint PASS', pass: otherPass }],
    linkIndicator: { observed } }), expected);
});
test('link failure is retained and allows every subsequent measurement to run', async () => {
  const output = { steps: [] }, saved = [];
  const stepCode = runner.slice(runner.indexOf('async function step('), runner.indexOf('const LINK_STEP ='));
  const step = new Function('output', 'clean', 'save', `${stepCode};return step;`)(output, String,
    async () => { saved.push(structuredClone(output)); });
  const call = runner.slice(runner.indexOf('  await step(LINK_STEP,'), runner.indexOf("  await step('edit-lint PASS',lint);"));
  assert.ok(call.length > 0); assert.match(call, /\},true\);/);
  output.linkIndicator = { observed: false };
  await new Function('step', 'LINK_STEP', 'output', 'assert', `return (async()=>{${call}})();`)(step, LINK_STEP, output, assert);
  for (const name of ['edit-lint PASS', 'no generation CLI invocation or paid provider request', 'screenshots']) {
    await step(name, async () => ({ measured: true }));
  }
  assert.equal(output.linkIndicator.observed, false);
  assert.equal(output.steps[0].pass, false); assert.match(output.steps[0].error, /🔗/);
  assert.ok(output.steps.slice(1).every(result => result.pass)); assert.equal(saved.length, 4);
  assert.equal(measurementStatus(output), 'pass-except-link');
  assert.doesNotMatch(runner, /assert\.ok\(output\.linkIndicator\?\.observed/);
});
