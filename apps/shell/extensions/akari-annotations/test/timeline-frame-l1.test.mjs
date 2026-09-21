import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// Exercise runner cleanup with fake ps results; no Electron or real process signals.
const source = readFileSync(new URL('../evidence/timeline-frame-tool/l1-timeline-frame-tool.mjs', import.meta.url), 'utf8');
const listCode = source.slice(source.indexOf('async function listOwnedProcesses()'), source.indexOf('async function stopElectron()'));
const stopCode = source.slice(source.indexOf('async function stopElectron()'), source.indexOf('async function lint()'));
const iso = '/tmp/akari-frame-tool-l1-unique';
test('cleanup ps filter keeps only this run, excluding the runner itself', async () => {
  const list = new Function('promisify', 'execFile', 'ISO', 'process', `${listCode};return listOwnedProcesses;`)(
    () => async (command, args) => {
      assert.equal(command, '/bin/ps'); assert.deepEqual(args, ['-axo', 'pid=,command=']);
      return { stdout: ` 10 node runner ${iso}\n 20 Electron --user-data-dir=${iso}/userdata\n 30 Electron Helper --path=${iso}/config\n 40 Electron --path=/tmp/other-run\n` };
    }, null, iso, { pid: 10 });
  assert.deepEqual((await list()).map(p => p.pid), [20, 30]);
});
for (const survivor of [false, true]) test(`cleanup closes pipes, kills matching helper PIDs, retains evidence if surviving=${survivor}`, async () => {
  const events = [], output = { status: 'pass' }, fakeProcess = {};
  const child = { pid: 20, exitCode: null, signalCode: null,
    stdout: { destroy: () => events.push('stdout destroyed') }, stderr: { destroy: () => events.push('stderr destroyed') },
    unref: () => events.push('unref') };
  let scan = 0;
  const list = async () => {
    scan++;
    if (scan === 1) return [{ pid: 20 }, { pid: 30 }];
    return survivor || scan === 2 ? [{ pid: 30 }] : [];
  };
  fakeProcess.kill = (pid, signal) => { assert.ok([20, 30].includes(pid)); events.push({ pid, signal });
    if (pid === 20) child.signalCode = signal; };
  const stop = new Function('child', 'output', 'process', 'listOwnedProcesses', 'sleep', 'rm', 'ISO', 'clean',
    `${stopCode};return stopElectron;`)(child, output, fakeProcess, list, async () => {},
    async target => { assert.equal(target, iso); events.push('removed'); }, iso, String);
  await stop();
  assert.deepEqual(events.slice(0, 2), ['stdout destroyed', 'stderr destroyed']);
  assert.ok(events.some(e => e.pid === 30 && e.signal === 'SIGKILL'));
  assert.equal(output.cleanup.exited, !survivor);
  assert.equal(events.includes('removed'), !survivor);
  assert.ok(events.includes('unref'));
  assert.equal(output.status, survivor ? 'fail' : 'pass');
});
