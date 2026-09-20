import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const widgets = [
    { file: 'akari-review-panel-widget.ts', className: 'AkariReviewPanelWidget', render: 'renderList' },
    { file: 'akari-review-board-widget.ts', className: 'AkariReviewBoardWidget', render: 'renderColumns' },
];

function createFixture(definition) {
    const source = ts.createSourceFile(definition.file, readFileSync(
        new URL(`../src/browser/${definition.file}`, import.meta.url), 'utf8'
    ), ts.ScriptTarget.Latest, true);
    const widget = source.statements.find(statement => ts.isClassDeclaration(statement)
        && statement.name?.text === definition.className);
    assert.ok(widget, definition.className);
    const methods = ['deleteAnnotationById', 'undoDeleteAnnotation'].map(name => {
        const method = widget.members.find(member => member.name?.getText(source) === name);
        assert.ok(method, `${definition.className}.${name}`);
        return method.getText(source);
    });
    const code = ts.transpileModule(`class Handler { ${methods.join('\n')} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 },
    }).outputText;
    const timers = [];
    const cleared = [];
    const schedule = (callback, delay) => {
        const timer = { callback, delay };
        timers.push(timer);
        return timer;
    };
    const cancel = timer => cleared.push(timer);
    const Handler = new Function(
        'ANNOTATION_UNDO_TIMEOUT_MS', 'setTimeout', 'clearTimeout',
        `${code}\nreturn Handler;`
    )(6000, schedule, cancel);
    const context = new Handler();
    const annotation = { id: 'a-0001', status: 'open', text: '対象' };
    const calls = { deleted: [], restored: [], renders: 0 };
    context.pendingUndo = new Map();
    context.model = {
        annotations: [annotation],
        deleteAnnotation: async id => calls.deleted.push(id),
        restoreAnnotation: async value => calls.restored.push(value),
    };
    context[definition.render] = () => { calls.renders++; };
    context.errorMessage = error => String(error);
    context.showNotice = () => {};
    context.footer = {};
    context.messages = { error: () => {} };
    return { context, annotation, calls, timers, cleared };
}

for (const definition of widgets) {
    test(`${definition.className} は削除後に取り消し状態を置き、期限で外す`, async () => {
        const { context, calls, timers } = createFixture(definition);
        await context.deleteAnnotationById('a-0001');
        assert.deepEqual(calls.deleted, ['a-0001']);
        assert.equal(context.pendingUndo.has('a-0001'), true);
        assert.equal(timers[0].delay, 6000);
        timers[0].callback();
        assert.equal(context.pendingUndo.has('a-0001'), false);
        assert.equal(calls.renders, 1);
    });

    test(`${definition.className} は取り消し時に同じ注釈を復元して状態を外す`, async () => {
        const { context, annotation, calls, cleared } = createFixture(definition);
        await context.deleteAnnotationById('a-0001');
        const timer = context.pendingUndo.get('a-0001').timer;
        await context.undoDeleteAnnotation('a-0001');
        assert.deepEqual(calls.restored, [annotation]);
        assert.equal(context.pendingUndo.has('a-0001'), false);
        assert.deepEqual(cleared, [timer]);
        assert.equal(calls.renders, 1);
    });
}
