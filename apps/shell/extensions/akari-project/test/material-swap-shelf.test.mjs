import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as candidates from '../lib/common/material-swap-candidates.js';
const require = createRequire(import.meta.url), React = require('react');
const source = readFileSync(new URL('../lib/browser/akari-role-buckets-widget.js', import.meta.url), 'utf8');
function method(name) {
 const start = source.search(new RegExp('    (async )?' + name + '\\(')); assert.notEqual(start, -1);
 const rest = source.slice(start); return rest.slice(0, rest.indexOf('\n    }') + 6);
}
const Widget = new Function('material_swap_candidates_1', 'React', 'akari_surface_tokens_1', `return class {
 ${['openMaterialSwap','clearMaterialSwap','closeMaterialSwap','renderMaterialSwap','selectTopView'].map(method).join('\n')}
}`)(candidates, React, { AKARI_BORDER: { hairline: '1px solid' } });
function fixture(meta = true) {
 const calls = [], cards = [0,1,2,3,4,5,6,7].map(n => ({ id: `sfx-pop-${n}`, key: `audio/sfx-pop-${n}`, category: 'audio', tags: ['sfx'], title: `Sound ${n}`, origin: 'resolver' }));
 const root = { toString: () => 'project', resolve: value => value };
 const w = Object.assign(new Widget(), { swapLoadGeneration: 0, workflow: { workspaceRoot: root }, assetCatalogItems: cards,
 files: { readFile: async path => { calls.push(['read', path]); if (!meta) throw Error('missing'); return { value: JSON.stringify({ title: 'Old', tags: ['sfx'] }) }; } },
 loadAssetCatalogView: async () => calls.push(['load']), selectTopView: view => calls.push(['view', view]), update() {},
 commandService: { executeCommand: (...args) => calls.push(args) }, renderCatalogCard: item => React.createElement('card', { item }) });
 return { w, calls };
}
const request = { itemId: 'audio-1', kind: 'audio', currentRelativePath: 'assets/audio/sfx-pop-old/old.wav' };
test('shelf lazily reads meta on open, renders two tiers, and card click only tries', async () => {
 const { w, calls } = fixture(); assert.deepEqual(calls, []); await w.openMaterialSwap(request);
 assert.equal(w.materialSwap.candidates.near.length, 6); assert.equal(w.materialSwap.candidates.rest.length, 2);
 const rendered = w.renderMaterialSwap(), near = rendered.props.children[1];
 const card = near.props.children[1].props.children[0];
 card.props.onClick({ target: { closest: () => true } }); assert.equal(calls.filter(([id]) => id === 'akari.timeline.tryMaterialSwap').length, 0);
 card.props.onClick({ target: { closest: () => false } }); assert.equal(calls.at(-1)[0], 'akari.timeline.tryMaterialSwap');
 w.closeMaterialSwap(); assert.equal(w.materialSwap, undefined); assert.deepEqual(calls.at(-1), ['akari.timeline.finishMaterialSwap', false]);
});
test('missing meta has no near tier and closing invalidates pending shelf load', async () => {
 const { w } = fixture(false); await w.openMaterialSwap(request); assert.equal(w.materialSwap.candidates.near, undefined);
 let release; w.loadAssetCatalogView = () => new Promise(resolve => { release = resolve; });
 const open = w.openMaterialSwap(request); w.clearMaterialSwap(); release(); assert.equal(await open, false); assert.equal(w.materialSwap, undefined);
});

test('AKARI Sounds without meta uses catalog title/tags and excludes the installed material', async () => {
 const { w } = fixture(false);
 await w.openMaterialSwap({ ...request, currentRelativePath: 'assets/audio/sfx-pop-2/sfx-pop-2.mp3' });
 assert.equal(w.materialSwap.title, 'Sound 2');
 assert.equal(w.materialSwap.candidates.near.length, 6);
 assert.equal(w.materialSwap.candidates.rest.length, 1);
 assert.equal([...w.materialSwap.candidates.near,...w.materialSwap.candidates.rest].some(row => row.item.id === 'sfx-pop-2'), false);
});
test('project segment closes the shelf and calls the shared rollback command', async () => {
 const { w, calls } = fixture(); await w.openMaterialSwap(request);
 delete w.selectTopView;
 w.topView = 'catalog'; w.stopCatalogAudio = () => {};
 w.selectTopView('materials');
 assert.equal(w.materialSwap, undefined); assert.equal(w.topView, 'materials');
 assert.deepEqual(calls.at(-1), ['akari.timeline.finishMaterialSwap', false]);
});
