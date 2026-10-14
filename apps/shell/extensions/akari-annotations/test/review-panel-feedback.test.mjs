import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/akari-review-panel-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('akari-review-panel-widget.ts', source, ts.ScriptTarget.Latest, true);
const panel = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariReviewPanelWidget');
const methods = ['commitSessionDelete', 'flushSessionDeletes'];
const code = ts.transpileModule(`class Widget { ${methods.map(name =>
    panel.members.find(member => member.name?.getText(ast) === name).getText(ast)).join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const createWidget = new Function('t', 'window', 'CustomEvent', 'REVIEW_SESSION_REFRESH_EVENT', `${code}; return Widget;`);

function deletionWidget(deleteReviewSession) {
    const events = [];
    const Widget = createWidget(
        (key, options) => key.endsWith('recordingNotFound') ? 'Recording not found' : `Could not delete: ${options.reason}`,
        { dispatchEvent: event => events.push(event) },
        class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
        'review-session-refresh'
    );
    const widget = new Widget();
    const notices = [];
    const errors = [];
    widget.pendingSessionDeletes = new Map([['s-0001', {
        timer: setTimeout(() => {}, 10000), projectRootUri: 'file:///project'
    }]]);
    widget.previewService = { deleteReviewSession };
    widget.messages = { error: message => errors.push(message) };
    widget.showNotice = message => notices.push(message);
    widget.hideNotice = () => {};
    widget.renderRecordingSection = () => {};
    widget.errorMessage = error => error.message;
    widget.reviewSessionState = { sessions: [{ id: 's-0001' }, { id: 's-0002' }] };
    widget.model = { location: {
        root: { normalizePath: () => ({ toString: () => 'file:///project' }) },
        editUri: { normalizePath: () => ({ toString: () => 'file:///project/edit.json' }) }
    } };
    return { widget, notices, errors, events };
}

test('missing recording reports both errors and leaves the stale card removed', async () => {
    const { widget, notices, errors, events } = deletionWidget(async () => false);
    await widget.commitSessionDelete('s-0001');
    assert.deepEqual(notices, ['Recording not found']);
    assert.deepEqual(errors, notices);
    assert.deepEqual(widget.reviewSessionState.sessions.map(session => session.id), ['s-0002']);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'review-session-refresh');
    assert.equal(widget.pendingSessionDeletes.size, 0);
});

test('RPC rejection reports both errors and keeps the recording card', async () => {
    const { widget, notices, errors, events } = deletionWidget(async () => { throw Error('RPC failed'); });
    await widget.commitSessionDelete('s-0001');
    assert.deepEqual(notices, ['Could not delete: RPC failed']);
    assert.deepEqual(errors, notices);
    assert.deepEqual(widget.reviewSessionState.sessions.map(session => session.id), ['s-0001', 's-0002']);
    assert.equal(events.length, 0);
});

test('successful recording deletion does not report an error', async () => {
    const { widget, notices, errors, events } = deletionWidget(async () => true);
    await widget.commitSessionDelete('s-0001');
    assert.deepEqual(notices, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(widget.reviewSessionState.sessions.map(session => session.id), ['s-0002']);
    assert.equal(events.length, 1);
});

test('hidden, disposed and switched panels flush deletion through the same error path', async () => {
    assert.match(source, /onBeforeHide\(msg: Message\): void \{\s*this\.flushSessionDeletes\(\)/);
    assert.match(source, /dispose: \(\) => this\.flushSessionDeletes\(\)/);
    const context = source.slice(source.indexOf('    protected refreshReviewSessionContext('), source.indexOf('    protected ', source.indexOf('    protected refreshReviewSessionContext(') + 1));
    assert.equal((context.match(/this\.flushSessionDeletes\(\)/g) ?? []).length, 2);
    const { widget, notices, errors } = deletionWidget(async () => false);
    widget.flushSessionDeletes();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(errors, notices);
    assert.equal(errors.length, 1);
});

test('composer Enter ignores IME confirmation and submits a normal Enter', () => {
    const handler = source.match(/this\.textInput\.addEventListener\('keydown', (event => \{[\s\S]*?\n        \})\);/)[1];
    let submitted = 0;
    const onKeydown = new Function(`return ${handler};`).call({ submitAnnotation: () => { submitted++; } });
    for (const composition of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) {
        let prevented = false;
        onKeydown({ key: 'Enter', ...composition, preventDefault: () => { prevented = true; } });
        assert.equal(prevented, false);
        assert.equal(submitted, 0);
    }
    let prevented = false;
    onKeydown({ key: 'Enter', isComposing: false, keyCode: 13, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(submitted, 1);
});
