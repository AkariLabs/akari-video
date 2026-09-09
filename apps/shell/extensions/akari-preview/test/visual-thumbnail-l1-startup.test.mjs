import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { runElectron, sanitize, forwardSanitizedLines } from '../../../../../dev-fixtures/visual-thumbnail-visible-sample/run-l1.mjs';

const absoluteTestPath = (...segments) => ['', ...segments].join('/');

test('L1 initialization waits for ready, destroys windows on failure, and exits with a sanitized error', async t => {
  const exits = []; const logs = [];
  let ready; let initialized = false; let destroyed = 0;
  const readiness = new Promise(resolve => { ready = resolve; });
  const previousHome = process.env.AKARI_HOME;
  process.env.AKARI_HOME = '/tmp/akari-l1-startup';
  t.after(() => {
    if (previousHome === undefined) delete process.env.AKARI_HOME;
    else process.env.AKARI_HOME = previousHome;
  });
  t.mock.method(console, 'error', value => logs.push(value));
  const missingPath = absoluteTestPath('Users', 'example', 'worktree', 'missing.js');
  const running = runElectron({ app: { setPath() {}, on() {}, whenReady: () => readiness, exit: code => exits.push(code) },
    BrowserWindow: { getAllWindows: () => [{ destroy() { destroyed++; } }] } },
    async () => { initialized = true; throw Error(`Cannot load ${missingPath}`); });
  await Promise.resolve();
  assert.equal(initialized, false);
  ready();
  await running;
  assert.equal(initialized, true);
  assert.equal(destroyed, 1);
  assert.deepEqual(exits, [1]);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Cannot load <local-path>/);
  assert.ok(!logs[0].includes(absoluteTestPath('Users', '')));
});

test('L1 diagnostics redact workstation and temporary paths', () => {
  const paths = [
    'file://' + absoluteTestPath('Users', 'example', 'project', 'file.js'),
    absoluteTestPath('var', 'folders', 'xx', 'tmp', 'file'),
    absoluteTestPath('private', 'tmp', 'test')
  ];
  assert.equal(sanitize(paths.join(' ')),
    '<local-path> <local-path> <local-path>');
});

test('the actual Electron ESM entry evaluates before ready and handles readiness rejection', () => {
  const runner = new URL('../../../../../dev-fixtures/visual-thumbnail-visible-sample/run-l1.mjs', import.meta.url).href;
  // Emulate Electron's ready barrier: readiness cannot settle until import() has completed.
  // The former top-level await deadlocks this subprocess and fails the bounded timeout.
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import Module from 'node:module';
    import { fileURLToPath } from 'node:url';
    const runner = ${JSON.stringify(runner)};
    process.argv[1] = fileURLToPath(runner);
    process.env.AKARI_HOME = '/tmp/akari-ready-probe';
    Object.defineProperty(process.versions, 'electron', { value: 'ready-probe' });
    let rejectReady; let exited; let readyRequested = false;
    const ready = new Promise((_, reject) => { rejectReady = reject; });
    const exit = new Promise(resolve => { exited = resolve; });
    const electron = { app: {
      setPath() {}, on() {}, whenReady() { readyRequested = true; return ready; }, exit: exited
    } };
    const load = Module._load;
    Module._load = function(name, ...args) {
      return name === 'electron' ? electron : load.call(this, name, ...args);
    };
    await import(runner);
    assert.equal(readyRequested, true, 'the Electron entry branch must actually run');
    console.log('PASS: Electron entry evaluated while ready remained pending');
    rejectReady(Error('ready probe failure'));
    assert.equal(await exit, 1);
    console.log('PASS: ready rejection exits with code 1');
  `], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(output, /PASS: Electron entry evaluated while ready remained pending/);
  assert.match(output, /PASS: ready rejection exits with code 1/);
});

test('child output is forwarded before exit, with split paths and UTF-8 redacted per line', async () => {
  const stream = new PassThrough(); const output = [];
  const lines = forwardSanitizedLines(stream, line => output.push(line));
  const userPath = absoluteTestPath('Users', 'example', 'secret.js');
  stream.write('boot\nerror: ' + userPath.slice(0, 3));
  assert.deepEqual(output, ['boot'], 'complete lines are forwarded before the stream closes');
  stream.write(userPath.slice(3) + '\n');
  assert.deepEqual(output, ['boot', 'error: <local-path>']);
  const utf8 = Buffer.from('準備完了\n');
  stream.write(utf8.subarray(0, 1)); stream.write(utf8.subarray(1));
  assert.equal(output[2], '準備完了');
  const closed = once(lines, 'close');
  stream.end(absoluteTestPath('var', 'folders', 'example', 'tail'));
  await closed;
  assert.equal(output[3], '<local-path>', 'an unterminated final line is also redacted');
});
