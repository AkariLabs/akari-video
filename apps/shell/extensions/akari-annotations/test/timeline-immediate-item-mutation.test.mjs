import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const file = new URL('../src/browser/akari-annotations-widget.ts', import.meta.url);
const source = ts.createSourceFile('widget.ts', readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const widget = source.statements.find(node => ts.isClassDeclaration(node)
    && node.name?.text === 'AkariAnnotationsWidget');
const method = widget.members.find(node => node.name?.getText(source) === 'commitImmediateItemMutation');
const writeMethod = widget.members.find(node => node.name?.getText(source) === 'writeEditSnapshotGuarded');
const zMethod = widget.members.find(node => node.name?.getText(source) === 'moveSelectedZOrder');
assert.ok(method);
assert.ok(writeMethod);
assert.ok(zMethod);
const code = ts.transpileModule(`class Harness { ${method.getText(source)} ${writeMethod.getText(source)}
    ${zMethod.getText(source)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const Harness = new Function('planZOrderMove', 'moveTreeV2Item', `${code}\nreturn Harness;`)(
    () => ({ target: { track: 'V2' }, atFrames: 0 }),
    doc => ({ document: { ...doc, ids: [...doc.ids].reverse() } })
);

function fixture(ids) {
    const context = new Harness();
    const initial = { version: 2, ids: [...ids] };
    let disk = structuredClone(initial);
    const gates = [];
    const history = [];
    context.editDocument = structuredClone(initial);
    context.editMutationTail = Promise.resolve();
    context.immediateItemRevision = 0;
    context.projectImmediateItemEdit = (next, removedIds) => {
        context.editDocument = next;
        context.visibleIds = [...next.ids];
        context.lastRemovedIds = [...removedIds];
    };
    context.errorMessage = error => error.message;
    context.commitEditMutation = (_label, mutate) => {
        const operation = context.editMutationTail.then(async () => {
            const before = structuredClone(disk);
            const after = mutate(structuredClone(before));
            await new Promise((resolve, reject) => gates.push({ resolve, reject }));
            disk = after;
            history.push(before);
            return { before: JSON.stringify(before), after: JSON.stringify(after), result: { committed: true } };
        });
        context.editMutationTail = operation.catch(() => undefined);
        return operation;
    };
    context.reloadEdit = async () => { context.editDocument = structuredClone(disk); context.visibleIds = [...disk.ids]; };
    return { context, gates, history, initial, disk: () => disk };
}

const remove = id => doc => ({ ...doc, ids: doc.ids.filter(value => value !== id) });
const turn = () => new Promise(resolve => setImmediate(resolve));

test('five deletes project immediately and save in order, then five undo snapshots restore the document', async () => {
    const { context, gates, history, initial, disk } = fixture(['a', 'b', 'c', 'd', 'e']);
    const writes = initial.ids.map(id => context.commitImmediateItemMutation('delete', remove(id), [id]));
    assert.deepEqual(context.visibleIds, []);
    assert.deepEqual(disk(), initial);
    for (let index = 0; index < 5; index += 1) {
        await turn();
        assert.equal(gates.length, index + 1);
        gates[index].resolve();
    }
    await Promise.all(writes);
    assert.deepEqual(disk().ids, []);
    for (const before of history.reverse()) context.editDocument = before;
    assert.deepEqual(context.editDocument, initial);
});

test('a rejected save restores the visible snapshot and exposes the error', async () => {
    const { context, gates, initial } = fixture(['a', 'b']);
    const write = context.commitImmediateItemMutation('delete', remove('a'), ['a']);
    assert.deepEqual(context.visibleIds, ['b']);
    await turn();
    gates[0].reject(new Error('disk full'));
    await assert.rejects(write, /disk full/);
    assert.deepEqual(context.editDocument, initial);
    assert.deepEqual(context.visibleIds, ['a', 'b']);
});

test('snapshot save completes while the later lint result is still pending', async () => {
    const context = new Harness();
    let resolveLint;
    const lint = new Promise(resolve => { resolveLint = resolve; });
    context.location = { editUri: { toString: () => 'edit' }, root: { toString: () => 'root' },
        captionsUri: { toString: () => 'captions' } };
    context.annotationsService = { writeEditSnapshot: async () => ({ lint }) };
    await context.writeEditSnapshotGuarded('{"version":2}');
    resolveLint();
});

test('z-order moves before save and reports a rejected save', async () => {
    const { context, gates } = fixture(['back', 'front']);
    const notices = [];
    context.footer = { textContent: '' };
    context.showNotice = notice => notices.push(notice);
    context.hideNotice = () => {};
    context.moveSelectedZOrder('back', 'front', 'move');
    assert.deepEqual(context.visibleIds, ['front', 'back']);
    await turn();
    gates[0].reject(new Error('disk full'));
    await turn();
    assert.deepEqual(context.visibleIds, ['back', 'front']);
    assert.match(notices.at(-1), /disk full/);
});

test('delete handlers use the immediate projection for non-cut items', () => {
    for (const name of ['performDeleteSelected', 'performDeleteMultiSelected', 'moveSelectedZOrder']) {
        const target = widget.members.find(node => node.name?.getText(source) === name);
        assert.match(target.getText(source), /commitImmediateItemMutation/u, name);
    }
});
