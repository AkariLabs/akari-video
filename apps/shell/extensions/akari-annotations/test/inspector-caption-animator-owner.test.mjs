import assert from 'node:assert/strict';
import test from 'node:test';
import { animatorSection, timelineMethod } from './helpers/perspective-transition-fixture.mjs';

const captionAnimatorOwner = timelineMethod('captionAnimatorOwner', {});
const animator = (id = 'a1') => ({
    id, basis: 'chars', shape: 'ramp', start: 0, end: 0.3, offset: 0, amount: {}
});
const bag = (id = 'captions-bag', fields = {}) => ({ id, source: { kind: 'captions' }, ...fields });
const ownerFor = (items, captionId = 'cue-1') => captionAnimatorOwner.call({
    editDocument: { tracks: [{ id: 'video', items }] }
}, captionId);

test('cue の袋は exclude が空または未設定なら id を返す', () => {
    for (const source of [{ kind: 'captions' }, { kind: 'captions', exclude: [] }]) {
        assert.deepEqual(ownerFor([bag('captions-bag', { source })]), { id: 'captions-bag' });
    }
});

test('cue の袋は animator 配列だけを現在値として返す', () => {
    for (const value of [[], [animator()]]) {
        assert.deepEqual(ownerFor([bag('captions-bag', { animator: value })]), {
            id: 'captions-bag', animator: value
        });
    }
    for (const value of [undefined, null, {}, 'invalid']) {
        assert.deepEqual(ownerFor([bag('captions-bag', { animator: value })]), { id: 'captions-bag' });
    }
});

test('exclude された cue は袋を持たず、別の cue はその袋に属する', () => {
    const items = [bag('excluded', { source: { kind: 'captions', exclude: ['cue-1'] } })];
    assert.equal(ownerFor(items), undefined);
    assert.deepEqual(ownerFor(items, 'cue-2'), { id: 'excluded' });
});

test('袋がない文書では cue 自身の animator を所有者として扱わない', () => {
    assert.equal(ownerFor([{ id: 'cue-1', source: { kind: 'caption' }, animator: [animator()] }]), undefined);
    assert.equal(ownerFor([]), undefined);
    for (const editDocument of [undefined, {}, { tracks: [] }]) {
        assert.equal(captionAnimatorOwner.call({ editDocument }, 'cue-1'), undefined);
    }
});

test('入れ子の袋を再帰探索し、除外されていない最初の袋を採用する', () => {
    const state = { editDocument: { tracks: [
        { id: 'first-track', items: [
            bag('excluded', { source: { kind: 'captions', exclude: ['cue-1'] } }),
            { id: 'group', items: [{ id: 'inner-group', items: [bag('nested')] }] },
            bag('later-sibling')
        ] },
        { id: 'second-track', items: [bag('later-track')] }
    ] } };
    assert.deepEqual(captionAnimatorOwner.call(state, 'cue-1'), { id: 'nested' });
});

test('先のトラックに候補がなければ次のトラックの袋を採用する', () => {
    const state = { editDocument: { tracks: [
        { id: 'first-track', items: [{ id: 'media', source: { kind: 'media' } }] },
        { id: 'second-track', items: [bag()] }
    ] } };
    assert.deepEqual(captionAnimatorOwner.call(state, 'cue-1'), { id: 'captions-bag' });
});

test('cue 文脈のアニメーター節は袋の見出しを表示し、追加を袋 id に書き込む', async () => {
    const snapshot = { kind: 'caption', id: 'cue-1', animatorOwner: ownerFor([bag()]) };
    const writes = [];
    const owner = snapshot.animatorOwner;
    const section = animatorSection(owner.id, `袋 ${owner.id} のアニメーター（全 cue に効く）`, owner.animator,
        async request => { writes.push(request); return { ok: true }; });
    assert.equal(section.id, 'animator');
    assert.equal(section.label, '袋 captions-bag のアニメーター（全 cue に効く）');
    assert.equal(section.collapsedByDefault, true);
    const add = section.fields.find(field => field.name === 'animator-add');
    assert.equal(add.label, 'アニメーターを追加');
    assert.deepEqual(await add.write(snapshot, 'アニメーター'), { ok: true });
    assert.deepEqual(writes, [{ kind: 'item-field', id: 'captions-bag', path: 'animator', value: [animator()] }]);
});

test('cue 文脈からの追加は袋の既存 animator を維持する', async () => {
    const existing = { ...animator(), amount: { y: 24 } };
    const owner = ownerFor([bag('captions-bag', { animator: [existing] })]);
    const writes = [];
    const section = animatorSection(owner.id, `袋 ${owner.id} のアニメーター（全 cue に効く）`, owner.animator,
        async request => { writes.push(request); return { ok: true }; });
    await section.fields.find(field => field.name === 'animator-add').write({ kind: 'caption', id: 'cue-1' }, 'アニメーター');
    assert.deepEqual(writes, [{
        kind: 'item-field', id: 'captions-bag', path: 'animator', value: [existing, animator('a2')]
    }]);
});
