import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { appendConnectionDiagnostic, appendDiagnosticLogLines, connectionDiagnosticLogLine, resolvePreviewDiagnosticsLogPath } =
    require('../lib/electron-main/connection-diagnostics-log.js');
const { PREVIEW_DIAGNOSTICS_LOG_MAX_BYTES } = require('../lib/common/preview-init-diagnostics.js');
const { PreviewDiagnosticsLog } = require('../lib/browser/preview-diagnostics.js');

test('connection and power events use one JSON Lines record each', () => {
    const at = '2026-10-07T00:00:00.000Z';
    for (const event of ['socket-disconnect', 'socket-reconnect', 'power-suspend', 'power-resume', 'power-lock-screen', 'power-unlock-screen']) {
        const line = connectionDiagnosticLogLine(event, event === 'socket-disconnect' ? 'ping timeout' : undefined, at);
        assert.equal(line.endsWith('\n'), true);
        assert.equal(line.trimEnd().includes('\n'), false);
        const entry = JSON.parse(line);
        assert.deepEqual(entry, {
            at,
            entry: 'desktop-host',
            event,
            ...(event === 'socket-disconnect' ? { reason: 'ping timeout' } : {})
        });
    }
});

test('frontend records disconnect reason and subsequent reconnect', () => {
    const source = ts.createSourceFile('connection-diagnostics-contribution.ts',
        readFileSync(new URL('../src/browser/connection-diagnostics-contribution.ts', import.meta.url), 'utf8'),
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ConnectionDiagnosticsContribution');
    const method = owner.members.find(node => node.name?.getText(source) === 'onStart');
    const compiled = ts.transpileModule(`class Contribution { ${method.getText(source)} }\nContribution`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const events = new Map();
    const records = [];
    const Contribution = vm.runInContext(compiled, vm.createContext({
        window: { electronAkariPreview: { recordConnectionDiagnostic: (...args) => records.push(args) } }
    }));
    const contribution = new Contribution();
    contribution.connectionSource = { socket: { on: (name, handler) => events.set(name, handler) } };
    contribution.onStart();
    events.get('connect')();
    assert.equal(records.length, 0);
    events.get('disconnect')('ping timeout');
    events.get('connect')();
    assert.deepEqual(records, [
        ['socket-disconnect', 'ping timeout'],
        ['socket-reconnect']
    ]);
});

test('Electron main resolves AKARI_HOME before the default home directory', () => {
    assert.equal(resolvePreviewDiagnosticsLogPath({ AKARI_HOME: '/sandbox/akari' }, '/mock/home'),
        join('/sandbox/akari', 'logs', 'akari-preview-diagnostics.log'));
    assert.equal(resolvePreviewDiagnosticsLogPath({}, '/mock/home'),
        join('/mock/home', '.akari', 'logs', 'akari-preview-diagnostics.log'));
});

test('Electron main trims oldest complete JSON Lines at the byte limit', t => {
    const root = resolve(new URL('../../../../../', import.meta.url).pathname, '.tmp-lane');
    mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, 'diagnostics-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'logs', 'akari-preview-diagnostics.log');
    for (let index = 0; index < 6; index++) {
        appendDiagnosticLogLines([JSON.stringify({ at: '2026-10-07T00:00:00.000Z', entry: 'desktop-host', event: 'note', index,
            message: 'x'.repeat(180000) })], file);
    }
    assert.ok(statSync(file).size <= PREVIEW_DIAGNOSTICS_LOG_MAX_BYTES);
    const entries = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(entries.map(entry => entry.index), [4, 5]);
    for (const index of [6, 7]) {
        appendDiagnosticLogLines([JSON.stringify({ event: 'note', index, message: 'あ'.repeat(100000) })], file);
    }
    assert.ok(statSync(file).size <= PREVIEW_DIAGNOSTICS_LOG_MAX_BYTES);
    assert.deepEqual(readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line).index), [7]);
});

test('connection events use the same bounded AKARI_HOME log', t => {
    const root = resolve(new URL('../../../../../', import.meta.url).pathname, '.tmp-lane');
    mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, 'connection-'));
    const previous = process.env.AKARI_HOME;
    t.after(() => {
        if (previous === undefined) delete process.env.AKARI_HOME;
        else process.env.AKARI_HOME = previous;
        rmSync(dir, { recursive: true, force: true });
    });
    process.env.AKARI_HOME = dir;
    const file = resolvePreviewDiagnosticsLogPath();
    appendDiagnosticLogLines([JSON.stringify({ event: 'note', message: 'x'.repeat(PREVIEW_DIAGNOSTICS_LOG_MAX_BYTES - 100) })]);
    appendConnectionDiagnostic('socket-disconnect', 'ping timeout');
    appendConnectionDiagnostic('socket-reconnect');
    assert.ok(statSync(file).size <= PREVIEW_DIAGNOSTICS_LOG_MAX_BYTES);
    assert.deepEqual(readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line).event),
        ['socket-disconnect', 'socket-reconnect']);
});

test('preview diagnostics appendLines route never reads or rewrites the file', async () => {
    const batches = [];
    const log = new PreviewDiagnosticsLog({
        resolveLogUri: async () => 'file:///diagnostics.log',
        readText: async () => assert.fail('readText should not run'),
        writeText: async () => assert.fail('writeText should not run'),
        appendLines: async lines => { batches.push(lines); },
        warn: () => assert.fail('diagnostics write failed')
    });
    log.append({ at: '2026-10-07T00:00:00.000Z', entry: 'desktop-host', event: 'note', message: 'first' });
    await log.settled();
    log.append({ at: '2026-10-07T00:00:01.000Z', entry: 'desktop-host', event: 'note', message: 'second' });
    await log.settled();
    assert.deepEqual(batches.map(lines => lines.map(line => JSON.parse(line).message)), [['first'], ['second']]);
});
