import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as mutations from '../lib/common/edit-v2-mutations.js';

const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
function method(name) {
    const start = source.search(new RegExp('    (async )?' + name + '\\('));
    assert.notEqual(start, -1, name);
    const rest = source.slice(start);
    return rest.slice(0, rest.indexOf('\n    }') + 6);
}
const Widget = new Function('edit_v2_mutations_1', `return class {
    ${method('commitEditMutation')}
    ${method('performEditMutation')}
    ${method('frameAt')}
}`)(mutations);

function fixture() {
    let disk = mutations.stringifyEditV2({
        version: 2, value: 0, output: { fps: 30, width: 320, height: 180 }, sources: [], tracks: []
    });
    const w = Object.assign(new Widget(), {
        editMutationTail: Promise.resolve(), fps: 30, contentEndDuration: () => 0,
        location: { editUri: 'edit' },
        fileService: { readFile: async () => ({ value: disk }) },
        prepareMotionChanges: async () => [], writeMotionChanges: async () => {},
        pushHistory: () => {}, reloadCaptions: async () => {},
        reloadEdit: async source => { w.ui = JSON.parse(source ?? disk).value; },
        writeEditSnapshotGuarded: async source => { disk = source; }
    });
    return { w, disk: () => JSON.parse(disk).value, setDisk: source => { disk = source; } };
}

test('move renders before save, and queued moves read the previous saved result', async () => {
    const { w, disk, setDisk } = fixture();
    let finish, entered;
    const saving = new Promise(resolve => { entered = resolve; });
    let writes = 0;
    w.writeEditSnapshotGuarded = async source => {
        if (++writes === 1) {
            entered();
            await new Promise(resolve => { finish = resolve; });
        }
        setDisk(source);
    };
    const move = doc => ({ ...doc, value: doc.value + 1 });
    const first = w.commitEditMutation('move', move, { optimistic: true });
    // A rejection before the write must fail this test, not leave saving pending forever.
    await Promise.race([saving, first.then(() => assert.fail('move completed without entering the write'))]);
    try {
        assert.equal(w.ui, 1);
        assert.equal(disk(), 0);
        const second = w.commitEditMutation('move', move, { optimistic: true });
        finish();
        await Promise.all([first, second]);
        assert.equal(w.ui, 2);
        assert.equal(disk(), 2);
    } finally {
        finish();
        await first;
    }
});

test('failed save restores the disk snapshot', async () => {
    const { w, disk } = fixture();
    w.writeEditSnapshotGuarded = async () => { throw Error('write failed'); };
    await assert.rejects(w.commitEditMutation('move', doc => ({ ...doc, value: 1 }), { optimistic: true }), /write failed/);
    assert.equal(w.ui, 0);
    assert.equal(disk(), 0);
});
