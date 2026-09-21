import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSwapCandidates } from '../lib/common/material-swap-candidates.js';
const card = (id, extra = {}) => ({ id, key: `audio/${id}`, category: 'audio', tags: ['sfx'], origin: 'resolver', ...extra });
test('deterministic prefix, tags, id ranking; near <= 6, rest contains all remainder', () => {
 const items = Array.from({ length: 9 }, (_, n) => card(`sfx-pop-${n}`, { tags: n === 8 ? ['bright', 'short'] : [] }));
 items.push(card('sfx-other-1', { tags: ['bright'] }), card('bgm-calm-1', { tags: [] }));
 const current = { id: 'sfx-pop-old', tags: ['bright', 'short'] }, result = rankSwapCandidates(items, 'audio', current);
 assert.deepEqual(result, rankSwapCandidates([...items].reverse(), 'audio', current));
 assert.deepEqual(result.near.map(row => row.item.id), ['sfx-pop-8', 'sfx-pop-0', 'sfx-pop-1', 'sfx-pop-2', 'sfx-pop-3', 'sfx-pop-4']);
 assert.equal(result.rest.length, 5); assert.equal(new Set([...result.near, ...result.rest].map(row => row.item.key)).size, items.length);
});
test('locked/local stay in rest, cannot try; categories are separated', () => {
 const items = [card('sfx-pop-1', { state: 'locked' }), card('sfx-pop-2', { origin: 'local' }), card('br-1', { category: 'broll' })];
 const result = rankSwapCandidates(items, 'audio', { id: 'sfx-pop-0', tags: ['sfx'] });
 assert.equal(result.near.length, 0); assert.deepEqual(result.rest.map(row => row.canTry), [false, false]);
 assert.equal(rankSwapCandidates(items, 'visual').rest[0].item.id, 'br-1');
});
test('non-library source has no near tier and sorts every candidate by id', () => {
 const result = rankSwapCandidates([card('sfx-z'), card('bgm-a'), card('sfx-a')], 'audio');
 assert.equal(result.near, undefined); assert.deepEqual(result.rest.map(row => row.item.id), ['bgm-a', 'sfx-a', 'sfx-z']);
});
test('visual br-/bg- families rank with tags; still and broll share the shelf', () => {
 const items = [card('bg-a', { category: 'still', tags: ['nature'] }), card('br-z', { category: 'broll', tags: [] })];
 assert.deepEqual(rankSwapCandidates(items, 'visual', { id: 'br-old', tags: ['nature'] }).near.map(row => row.item.id), ['br-z', 'bg-a']);
});

test('current material is excluded and the remaining tier sorts by id, not score', () => {
 const current = { id: 'sfx-pop-current', tags: ['bright'] };
 const items = [card(current.id, { tags: ['bright'] }), ...Array.from({length:8}, (_, i) => card(`sfx-pop-${i}`, {tags:[]})),
  card('aaa', { tags: [] }), card('bbb', {tags:['bright']}), card('zzz', { state: 'locked' })];
 const result = rankSwapCandidates(items, 'audio', current);
 assert.equal([...result.near, ...result.rest].some(row => row.item.id === current.id), false);
 assert.deepEqual(result.near.map(row => row.item.id), ['sfx-pop-0','sfx-pop-1','sfx-pop-2','sfx-pop-3','sfx-pop-4','sfx-pop-5']);
 assert.deepEqual(result.rest.map(row => row.item.id), ['aaa','bbb','sfx-pop-6','sfx-pop-7','zzz']);
 assert.deepEqual(rankSwapCandidates(items, 'audio', undefined, 'assets/audio/sfx-pop-current/file.mp3').rest.map(row => row.item.id),
  items.filter(item => item.id !== current.id).map(item => item.id).sort());
});
