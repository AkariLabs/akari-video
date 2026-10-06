import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { collectDaihonCutCandidates } = require('../../lib/common/daihon-cut-candidates.js');
const { initialDaihonCutReview, reviewCandidates, chosenCandidates, setCutDecision,
    setKindDecision, confirmDaihonCutReview, willCut } = require('../../lib/common/daihon-cut-review.js');

const rows = [
    { id: 'a', src: 's1', start: 0, end: 1, outStart: 0, outEnd: 1, text: 'あの話',
        words: [{ text: 'あの', start: .2, end: .4 }, { text: '話', start: .4, end: .8 }], unrecognized: [] },
    { id: 'b', src: 's1', start: 1.8, end: 3, outStart: 1.8, outEnd: 3, text: '次の話',
        words: [{ text: 'えー', start: 2.7, end: 2.8 }], unrecognized: [{ start: 2.1, end: 2.3 }] },
    { id: 'removed', src: 's1', start: 3.2, end: 3.8, outStart: null, outEnd: null, text: 'えー',
        words: [{ text: 'えー', start: 3.3, end: 3.5 }], unrecognized: [] }
];
const sources = [{ sourceId: 's1', cuts: { candidates: [
    { id: 'r1', kind: 'redo', start: 2.4, end: 2.6, text: '次の', on: true }
], hand_edited: [] } }];
const options = { sources, segments: [{ kind: 'src', src: 's1', in: 0, out: 3 }], silences: [{ start: 1, end: 1.8 }] };

test('台本から4種類を集め、無音しきい値と切り済み区間を反映する', () => {
    const candidates = collectDaihonCutCandidates(rows, options);
    assert.deepEqual(Object.fromEntries(['silence', 'filler', 'redo', 'unrecognized'].map(kind =>
        [kind, candidates.filter(candidate => candidate.kind === kind).length])),
    { silence: 1, filler: 2, redo: 1, unrecognized: 1 });
    assert.equal(collectDaihonCutCandidates(rows, { ...options, minGapSec: .45 }).filter(candidate => candidate.kind === 'silence').length, 1);
    assert.equal(collectDaihonCutCandidates(rows, { ...options, minGapSec: 1 }).filter(candidate => candidate.kind === 'silence').length, 0);
    assert.equal(collectDaihonCutCandidates(rows, { ...options, sources: [{ sourceId: 's1', cuts: null }] })
        .filter(candidate => candidate.kind === 'redo').length, 0);
    assert.equal(collectDaihonCutCandidates(rows, { ...options, segments: [
        { kind: 'src', src: 's1', in: 0, out: .3 }, { kind: 'src', src: 's1', in: .5, out: 3 }
    ] }).filter(candidate => candidate.id === 'filler:a:0').length, 0);
    assert.ok(candidates.every(candidate => candidate.rowId !== 'removed'));
    assert.ok(candidates.every(candidate => candidate.start < 3 && candidate.end <= 3));
});

test('既定の採否、個別と種類一括、確定の書き込みは1回', async () => {
    const candidates = collectDaihonCutCandidates(rows, options);
    let state = initialDaihonCutReview();
    for (const kind of ['silence', 'filler', 'unrecognized'])
        assert.ok(candidates.filter(candidate => candidate.kind === kind).every(candidate => willCut(state, candidate)), kind);
    assert.ok(candidates.filter(candidate => candidate.kind === 'redo').every(candidate => !willCut(state, candidate)));
    assert.deepEqual(reviewCandidates(state, candidates).map(candidate => candidate.kind).sort(),
        ['filler', 'filler', 'silence', 'unrecognized']);
    state.kinds.redo = true;
    assert.equal(chosenCandidates(state, candidates).length, 4);
    for (const candidate of candidates.filter(candidate => candidate.kind === 'filler'))
        state = setCutDecision(state, candidate.id, false);
    assert.equal(chosenCandidates(state, candidates).length, 2);
    state = setKindDecision(state, candidates, 'filler', true);
    assert.ok(candidates.filter(candidate => candidate.kind === 'filler').every(candidate => willCut(state, candidate)));
    assert.equal(chosenCandidates(state, candidates).length, 4);
    let writes = 0;
    const apply = async selected => { writes++; assert.equal(selected.length, 4); return true; };
    assert.equal(writes, 0);
    state = await confirmDaihonCutReview(state, candidates, apply);
    assert.equal(state.step, 2);
    assert.equal(state.applied.length, 4);
    assert.equal(writes, 1);
});

test('素材が混在しても無音は素材をまたがず、言い直しは該当素材の行へ結び付く', () => {
    const mixed = [rows[0], { ...rows[1], src: 's2' }];
    const result = collectDaihonCutCandidates(mixed, { silences: [{ start: 1, end: 1.8 }],
        sources: [{ sourceId: 's1', cuts: sources[0].cuts }, { sourceId: 's2', cuts: sources[0].cuts }],
        segments: [{ kind: 'src', src: 's1', in: 0, out: 1 }, { kind: 'src', src: 's2', in: 1.8, out: 3 }] });
    assert.equal(result.filter(candidate => candidate.kind === 'silence').length, 0);
    assert.deepEqual(result.filter(candidate => candidate.kind === 'redo').map(candidate => candidate.sourceId), ['s2']);
});

test('単一素材の旧 edit で src のない保持区間も候補に使う', () => {
    const legacyRows = rows.slice(0, 2).map(({ src, ...row }) => ({ ...row, src: null }));
    const result = collectDaihonCutCandidates(legacyRows, { sources, silences: [{ start: 1, end: 1.8 }],
        segments: [{ kind: 'src', in: 0, out: 3 }] });
    assert.deepEqual(result.map(candidate => candidate.kind).sort(), ['filler', 'filler', 'redo', 'silence', 'unrecognized']);
});
