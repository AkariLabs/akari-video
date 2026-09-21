import assert from 'node:assert/strict';
import test from 'node:test';
import { GenerationPickController, GENERATION_PICK_INTO_COMMAND_ID, GENERATION_PICK_PRIMARY_SELECTED_EVENT,
    generationPickSelectionChanged, normalizeGenerationPickRequest,
    normalizeGenerationPickPath, generationPickBadge } from '../lib/common/generation-pick.js';

const request = (options = {}) => ({ slot: 'first_frame', label: '最初の絵', accepts: ['image'], multi: false, ...options });
const image = name => ({ path: `assets/${name}.png`, kind: 'image' });
const library = { key: 'still/sample', kind: 'image' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('command ID and request normalization preserve the project-relative contract', () => {
    assert.equal(GENERATION_PICK_INTO_COMMAND_ID, 'akari.generation.pickInto');
    const normalized = normalizeGenerationPickRequest(request({ multi: true, accepts: ['image', 'image', 'other'], max: 2.9,
        selected: ['./assets/a.png', 'assets/a.png', '/outside.png', '../outside.png', 'assets/b.png', 'assets/c.png', 'assets/clip.mp4'] }));
    assert.deepEqual(normalized.accepts, ['image']);
    assert.deepEqual(normalized.selected, ['assets/a.png', 'assets/b.png']);
    assert.equal(normalized.max, 2);
    for (const path of ['/abs.png', '../a.png', 'assets/../a.png', 'C:/a.png', 'file:a.png', 'a\\b.png', '']) {
        assert.equal(normalizeGenerationPickPath(path), undefined);
    }
    assert.deepEqual(normalizeGenerationPickRequest(request({ selected: ['assets/a.png'] })).selected, []);
});

test('single: one click resolves picked and exits the mode', async () => {
    const controller = new GenerationPickController(() => assert.fail('project material needs no resolver'));
    const result = controller.start(request());
    await controller.pick(image('a'));
    assert.deepEqual(await result, { status: 'picked', paths: ['assets/a.png'] });
    assert.equal(controller.request, undefined);
});

test('multi: toggle, ordered badges, max and complete', async () => {
    const controller = new GenerationPickController(async () => undefined);
    const result = controller.start(request({ multi: true, max: 2, selected: ['assets/a.png'] }));
    assert.equal(controller.badge(image('a')), '@画像1');
    await controller.pick(image('b'));
    assert.equal(controller.badge(image('b')), '@画像2');
    assert.match(controller.disabledReason(image('c')), /上限/);
    await controller.pick(image('c'));
    assert.deepEqual(controller.paths, ['assets/a.png', 'assets/b.png']);
    await controller.pick(image('a'));
    assert.equal(controller.badge(image('b')), '@画像1');
    await controller.pick(image('a'));
    assert.equal(controller.badge(image('a')), '@画像2');
    controller.complete();
    assert.deepEqual(await result, { status: 'picked', paths: ['assets/b.png', 'assets/a.png'] });
    assert.equal(controller.request, undefined);
});

test('mixed media ordinal labels are numbered within each kind', () => {
    const paths = ['assets/a.png', 'assets/a.mp4', 'assets/b.png', 'assets/a.wav'];
    assert.deepEqual(paths.map(path => generationPickBadge(paths, path)), ['@画像1', '@動画1', '@画像2', '@音声1']);
});

for (const trigger of ['Esc', 'やめる', 'panel close']) {
    test(`${trigger}: cancel resolves without paths`, async () => {
        const controller = new GenerationPickController(async () => undefined);
        const result = controller.start(request({ multi: true, selected: ['assets/a.png'] }));
        controller.cancel();
        controller.cancel();
        assert.deepEqual(await result, { status: 'cancelled' });
        assert.equal(controller.request, undefined);
    });
}

test('accepts and unavailable candidates cannot resolve or invoke the service', async () => {
    const controller = new GenerationPickController(() => assert.fail('disabled library must not resolve'));
    const result = controller.start(request());
    for (const candidate of [{ path: 'assets/clip.mp4', kind: 'video' }, { ...library, kind: 'audio' },
        { ...library, unavailableReason: '未購入' }, { path: '/outside.png', kind: 'image' }]) {
        assert.ok(controller.disabledReason(candidate));
        await controller.pick(candidate);
        assert.ok(controller.request);
        assert.deepEqual(controller.paths, []);
    }
    controller.cancel();
    await result;
});

test('second start cancels the previous request and owns subsequent picks', async () => {
    const controller = new GenerationPickController(async () => undefined);
    const first = controller.start(request());
    const second = controller.start(request({ label: '最後の絵', slot: 'last_frame' }));
    assert.deepEqual(await first, { status: 'cancelled' });
    await controller.pick(image('b'));
    assert.deepEqual(await second, { status: 'picked', paths: ['assets/b.png'] });
});

test('library: fake resolveCatalogMaterial supplies the returned project-relative path', async () => {
    const calls = [];
    const service = { resolveCatalogMaterial: async key => {
        calls.push(key); return { relativePath: 'assets/still/sample/image.png', kind: 'image' };
    } };
    const controller = new GenerationPickController(key => service.resolveCatalogMaterial(key));
    const result = controller.start(request());
    await controller.pick(library);
    assert.deepEqual(calls, ['still/sample']);
    assert.deepEqual(await result, { status: 'picked', paths: ['assets/still/sample/image.png'] });
});

test('pending acquisition blocks duplicate clicks and completion; resolved path toggles without reacquiring', async () => {
    const work = deferred(); let calls = 0;
    const controller = new GenerationPickController(() => { calls++; return work.promise; });
    const result = controller.start(request({ multi: true, max: 2 }));
    const pick = controller.pick(library);
    assert.equal(controller.pendingKey, library.key);
    await controller.pick(library);
    await controller.pick(image('a'));
    controller.complete();
    assert.ok(controller.request);
    work.resolve({ relativePath: 'assets/library.png', kind: 'image' });
    await pick;
    assert.equal(controller.pendingKey, undefined);
    assert.equal(controller.badge(library), '@画像1');
    await controller.pick(library);
    assert.deepEqual(controller.paths, []);
    await controller.pick(library);
    assert.equal(calls, 1);
    controller.complete();
    assert.deepEqual(await result, { status: 'picked', paths: ['assets/library.png'] });
});

for (const failure of ['undefined', 'throw', 'absolute', 'wrong kind', 'wrong extension']) {
    test(`library failure (${failure}) keeps mode and exposes error; retry succeeds`, async () => {
        let retry = false;
        const controller = new GenerationPickController(async () => {
            if (retry) return { relativePath: 'assets/retry.png', kind: 'image' };
            if (failure === 'throw') throw new Error('offline');
            if (failure === 'absolute') return { relativePath: '/outside.png', kind: 'image' };
            if (failure === 'wrong kind') return { relativePath: 'assets/a.mp4', kind: 'video' };
            if (failure === 'wrong extension') return { relativePath: 'assets/a.mp4', kind: 'image' };
        });
        const result = controller.start(request());
        await controller.pick(library);
        assert.ok(controller.request);
        assert.ok(controller.error);
        assert.equal(controller.pendingKey, undefined);
        retry = true;
        await controller.pick(library);
        assert.deepEqual(await result, { status: 'picked', paths: ['assets/retry.png'] });
    });
}

for (const failure of [false, true]) {
    test(`late ${failure ? 'failure' : 'success'} cannot alter a replacement session`, async () => {
        const work = deferred();
        const controller = new GenerationPickController(() => work.promise);
        const first = controller.start(request());
        const picking = controller.pick(library);
        const second = controller.start(request({ multi: true }));
        assert.deepEqual(await first, { status: 'cancelled' });
        if (failure) work.reject(new Error('late')); else work.resolve({ relativePath: 'assets/late.png', kind: 'image' });
        await picking;
        assert.deepEqual(controller.paths, []);
        assert.equal(controller.error, undefined);
        await controller.pick(image('b'));
        controller.complete();
        assert.deepEqual(await second, { status: 'picked', paths: ['assets/b.png'] });
    });
}

test('max zero blocks additions; empty multi can complete', async () => {
    const controller = new GenerationPickController(async () => undefined);
    const result = controller.start(request({ multi: true, max: 0 }));
    await controller.pick(image('a'));
    assert.deepEqual(controller.paths, []);
    controller.complete();
    assert.deepEqual(await result, { status: 'picked', paths: [] });
});


test('timeline selection comparison checks kind and id, including transitions to/from null', () => {
    assert.equal(GENERATION_PICK_PRIMARY_SELECTED_EVENT, 'akari.timeline.primarySelected');
    const selections = [null, { kind: 'cut', id: 'a' }, { kind: 'cut', id: 'b' }, { kind: 'caption', id: 'a' }];
    for (const [beforeIndex, before] of selections.entries()) {
        for (const [afterIndex, after] of selections.entries()) {
            const copy = after && { ...after };
            assert.equal(generationPickSelectionChanged(before, copy), beforeIndex !== afterIndex);
        }
    }
});

test('unobserved timeline selection counts as empty, not a fabricated clip identity', () => {
    assert.equal(generationPickSelectionChanged(undefined, null), false);
    assert.equal(generationPickSelectionChanged(undefined, { kind: 'cut', id: 'a' }), true);
});
