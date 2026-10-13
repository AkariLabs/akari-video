import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { setLanguage, t } from '@akari-video/i18n';
import { handPromptToPartner } from '../lib/common/partner-handoff.js';
import { handAnnotation, handPendingAnnotations } from '../lib/common/annotation-handoff-flow.js';
import { composeBatchAnnotationHandoff, pendingAnnotationHandoff } from '../lib/common/batch-annotation-handoff.js';
import { describePenStrokes } from '../lib/common/pen-stroke-description.js';
import { formatRecordingName } from '../lib/common/recording-name.js';
import { planCompileHandoff } from '../lib/common/compile-session-handoff.js';
import { reviewSessionBadge } from '../lib/browser/review-model.js';

setLanguage('ja');
test.after(() => setLanguage(undefined));

function annotation(id, status, sourceT, text, strokes = null) {
    return { id, status, sourceT, sourceRange: null, target: null, text, strokes };
}

function fakePort(result, selectAction = false) {
    const calls = [];
    return {
        calls,
        port: {
            typePrompt: async text => { calls.push(['type', text]); if (result === 'exception') throw Error('unavailable'); return result; },
            copy: async text => { calls.push(['copy', text]); },
            notify: async (message, action) => { calls.push(['notice', message, action]); return selectAction; },
            openPartner: async () => { calls.push(['open']); }
        }
    };
}

test('recording handoff uses the new prompt and typePrompt without immediate send', async () => {
    const widget = readFileSync(new URL('../src/browser/akari-review-panel-widget.ts', import.meta.url), 'utf8');
    assert.match(widget, /executeCommand\('akari\.partner\.typePrompt', text\)/);
    assert.doesNotMatch(widget, /akari\.partner\.injectPrompt/);
    const plan = planCompileHandoff([{ id: 's-0003', startedAt: '2026-10-13T00:00:00.000Z' }], 's-0003');
    assert.equal(plan.kind, 'copy');
    const prompt = plan.prompt;
    assert.equal(prompt, 'レビューの録音 s-0003 を文字起こしして、コメントにまとめて');
    const { calls, port } = fakePort('typed');
    assert.equal(await handPromptToPartner(prompt, '録音 3', port), 'typed');
    assert.deepEqual(calls[0], ['type', prompt]);
    assert.equal(calls.some(call => call[0] === 'copy'), false);
    assert.match(calls[1][1], /入力欄に入れました/);
});

test('partner outcomes control clipboard, notice and open action', async () => {
    for (const [result, expected, copy] of [
        ['unsupported', 'unsupported', false], ['no-partner', 'no-partner', true], ['exception', 'copied', true], [undefined, 'copied', true]
    ]) {
        const { calls, port } = fakePort(result);
        assert.equal(await handPromptToPartner('request', '注釈', port), expected);
        assert.equal(calls.some(call => call[0] === 'copy'), copy);
        const notice = calls.find(call => call[0] === 'notice');
        if (result === 'no-partner') {
            assert.match(notice[1], /パートナーが開いていません/);
            assert.equal(notice[2], 'パートナーを開く');
        } else if (result === 'unsupported') {
            assert.match(notice[1], /貼り付けてください/);
        } else {
            assert.match(notice[1], /コピーしました/);
        }
    }
    const clicked = fakePort('no-partner', true);
    await handPromptToPartner('request', '注釈', clicked.port);
    assert.deepEqual(clicked.calls.at(-1), ['open']);
});

test('single annotation marks handed only for typed and unsupported', async () => {
    const note = annotation('a-0001', 'open', 65, 'Fix this');
    for (const result of ['typed', 'unsupported', 'no-partner']) {
        const marked = [];
        let prompt;
        await handAnnotation(note, null, { hand: async text => { prompt = text; return result; }, markSent: async id => { marked.push(id); } });
        assert.match(prompt, /a-0001/);
        assert.deepEqual(marked, result === 'no-partner' ? [] : ['a-0001']);
    }
});

test('batch selection ignores filter state, uses open unsent in time order and marks all', async () => {
    const notes = [
        annotation('a-0002', 'open', 9, 'Line one\nLine two'),
        annotation('a-0001', 'open', 2, 'Earlier'),
        annotation('a-0003', 'addressed', 3, 'Done'),
        annotation('a-0004', 'open', 4, 'Already handed')
    ];
    const sent = new Set(['a-0004']);
    assert.deepEqual(pendingAnnotationHandoff(notes, sent).map(item => item.id), ['a-0001', 'a-0002']);
    const prompt = composeBatchAnnotationHandoff(pendingAnnotationHandoff(notes, sent));
    assert.equal(prompt, '未対応の注釈 2 件にまとめて対応して\n・a-0001 0:02 Earlier\n・a-0002 0:09 Line one Line two');
    const marked = [];
    await handPendingAnnotations(notes, sent, { hand: async () => 'typed', markSent: async id => { marked.push(id); } });
    assert.deepEqual(marked, ['a-0001', 'a-0002']);
    assert.deepEqual(await handPendingAnnotations([], sent, { hand: async () => { throw Error('called'); }, markSent: async () => {} }), []);
    assert.deepEqual(await handPendingAnnotations(notes, sent, { hand: async () => 'no-partner', markSent: async () => { throw Error('marked'); } }), pendingAnnotationHandoff(notes, sent));
});

test('batch line includes target and pen description when present', () => {
    const note = annotation('a-0001', 'open', 4, '本文', [{
        tool: 'pen', space: 'content-rect', points: [[.65, .76], [.85, .38]]
    }]);
    note.target = 'overlay:main';
    assert.equal(composeBatchAnnotationHandoff([note]),
        '未対応の注釈 1 件にまとめて対応して\n・a-0001 0:04 overlay:main 本文（ペンの線: 始点 65%, 76% → 終点 85%, 38%。右上へ）');
});

test('stroke description preserves direction, enclosure, multiplicity and fallback', () => {
    const stroke = points => ({ tool: 'pen', space: 'content-rect', points });
    const upperRight = stroke([[.65,.76],[.85,.38]]);
    assert.equal(describePenStrokes([upperRight]), 'ペンの線: 始点 65%, 76% → 終点 85%, 38%。右上へ');
    assert.match(describePenStrokes([stroke([[.8,.5],[.2,.5]])]), /左へ/);
    assert.match(describePenStrokes([stroke([[.5,.2],[.5,.8]])]), /下へ/);
    assert.match(describePenStrokes([stroke([[.2,.2],[.8,.2],[.8,.8],[.2,.8],[.2,.2]])]), /囲み。中心 50%, 50%/);
    assert.equal(describePenStrokes([upperRight, stroke([[.1,.1],[.2,.2]])]),
        'ペンの線: 始点 65%, 76% → 終点 85%, 38%。右上へ。ほか 1 本');
    assert.equal(describePenStrokes([{ tool: 'pen', space: 'image-rect', points: [[.1,.1],[.2,.2]] }]), 'ペン描画あり');
    assert.equal(describePenStrokes([{ tool: 'pen', space: 'canvas-rect', points: [[.1,.1],[.2,.2]] }]), 'ペン描画あり');
    assert.equal(describePenStrokes([stroke([[.1,.1]])]), 'ペン描画あり');
});

test('English handoff keeps stroke, batch heading and recording prompt in English', () => {
    setLanguage('en');
    try {
        const stroke = { tool: 'pen', space: 'content-rect', points: [[.65,.76],[.85,.38]] };
        assert.equal(describePenStrokes([stroke]), 'Pen stroke: start 65%, 76% → end 85%, 38%. Toward upper right');
        assert.equal(composeBatchAnnotationHandoff([annotation('a-0001', 'open', 4, 'Fix this', [stroke])]).split('\n')[0],
            'Address 1 open annotation');
        assert.equal(composeBatchAnnotationHandoff([
            annotation('a-0001', 'open', 4, 'Fix this'), annotation('a-0002', 'open', 8, 'Fix that')
        ]).split('\n')[0], 'Address these 2 open annotations together');
        assert.equal(describePenStrokes([stroke, stroke]),
            'Pen stroke: start 65%, 76% → end 85%, 38%. Toward upper right. 1 more stroke');
        assert.equal(describePenStrokes([stroke, stroke, stroke]),
            'Pen stroke: start 65%, 76% → end 85%, 38%. Toward upper right. 2 more strokes');
        assert.equal(t('annotations.reviewPanelWidget.text.strokeCount', { count: 1, n: 1 }), '1 stroke');
        assert.equal(t('annotations.reviewPanelWidget.text.strokeCount', { count: 2, n: 2 }), '2 strokes');
        assert.equal(t('annotations.reviewPanelWidget.text.batchSubject', { count: 1, n: 1 }), '1 annotation');
        assert.equal(t('annotations.reviewPanelWidget.text.batchSubject', { count: 2, n: 2 }), '2 annotations');
        assert.equal(reviewSessionBadge({ id: 's-0001', startedAt: '', status: 'compiled', compiledAnnotations: ['a-0001'] }).label,
            'Turned into 1 comment');
        assert.equal(reviewSessionBadge({ id: 's-0001', startedAt: '', status: 'compiled', compiledAnnotations: ['a-0001', 'a-0002'] }).label,
            'Turned into 2 comments');
        assert.equal(planCompileHandoff([{ id: 's-0003', startedAt: '2026-10-13T00:00:00.000Z' }], 's-0003').prompt,
            'Transcribe review recording s-0003 and turn it into comments');
    } finally {
        setLanguage('ja');
    }
});

test('panel renders card actions and disables an empty batch', () => {
    const widget = readFileSync(new URL('../src/browser/akari-review-panel-widget.ts', import.meta.url), 'utf8');
    const row = widget.slice(widget.indexOf('    protected renderAnnotationRow('), widget.indexOf('    protected renderUiTargetLabel('));
    assert.match(row, /row\.appendChild\(actions\)/);
    assert.match(row, /sendButton\.textContent = t\('annotations\.reviewPanelWidget\.text\.handToAi'\)/);
    assert.match(widget, /this\.batchButton\.disabled = pending\.length === 0/);
});

test('recording display name drops leading zeroes', () => {
    assert.equal(formatRecordingName('s-0003'), '録音 3');
});
