import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { connectionDiagnosticLogLine } = require('../lib/electron-main/connection-diagnostics-log.js');
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

test('preview diagnostics writer retains lines appended by Electron main', async () => {
    let content = '';
    const log = new PreviewDiagnosticsLog({
        resolveLogUri: async () => 'file:///diagnostics.log',
        readText: async () => content,
        writeText: async (_uri, text) => { content = text; },
        warn: () => assert.fail('diagnostics write failed')
    });
    log.append({ at: '2026-10-07T00:00:00.000Z', entry: 'desktop-host', event: 'note', message: 'before' });
    await log.settled();
    content += connectionDiagnosticLogLine('socket-disconnect', 'ping timeout');
    log.append({ at: '2026-10-07T00:00:01.000Z', entry: 'desktop-host', event: 'note', message: 'after' });
    await log.settled();
    assert.deepEqual(content.trim().split('\n').map(line => JSON.parse(line).event),
        ['note', 'socket-disconnect', 'note']);
});
