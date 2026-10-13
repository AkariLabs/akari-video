import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TRANSITION_FAMILIES, TRANSITION_VOCABULARY, transitionTypeOf } from '@akari-video/edit-store';
import { setLanguage, t } from '@akari-video/i18n';
import { createTransitionSelection, transitionDirectionRequest, transitionDurationRequest,
    transitionDirectionType, transitionDurationValue,
    transitionInspectorFields } from '../lib/common/transition-selection-model.js';
import { timelineDeletePlan } from '../lib/common/timeline-delete-plan.js';

const ref = { earlierItemId: 'a', laterItemId: 'b' };
const snapshot = patch => createTransitionSelection({ ref,
    earlier: { index: 2, name: 'First' }, later: { index: 3, name: 'Second' },
    locked: false, ...patch });

test('snapshot carries the resolved boundary values without a widget reference', () => {
    const value = snapshot({ declaration: { type: 'wipe-left', duration: 0.7 },
        placement: { state: 'shortened', effectiveSeconds: 0.4, reasons: ['incoming-room'], legacyOverlap: false },
        outgoingTailRoomSeconds: 0.8, incomingHeadRoomSeconds: 0,
        stripUrl: 'preview-strip.webp' });
    assert.equal(value.kind, 'transition');
    assert.deepEqual(value.ref, ref);
    assert.deepEqual(value.earlier, { index: 2, name: 'First' });
    assert.deepEqual(value.later, { index: 3, name: 'Second' });
    assert.deepEqual(value.placement, { state: 'shortened', effectiveSeconds: 0.4,
        reasons: ['incoming-room'], legacyOverlap: false });
    assert.equal(transitionInspectorFields(value).handles.length, 2);
});

test('inspector status uses the existing reason in priority order and hides blocked handles', () => {
    const declaration = { type: 'future-kind', duration: 0.5 };
    const handles = { outgoingTailRoomSeconds: 2, incomingHeadRoomSeconds: 1 };
    const cases = [
        [{ locked: true, block: 'gap', declaration, ...handles }, 'transition.inspector.status.locked'],
        [{ block: 'gap', declaration, ...handles }, 'transition.boundary.dead.gap'],
        [{ block: 'multi-track', declaration, ...handles }, 'transition.boundary.dead.multiTrack'],
        [{ block: 'track-order', declaration, ...handles }, 'transition.boundary.dead.trackOrder'],
        [{ block: 'gap', ...handles }, 'transition.boundary.block.gap'],
        [{ block: 'multi-track', ...handles }, 'transition.boundary.block.multiTrack'],
        [{ block: 'track-order', ...handles }, 'transition.boundary.block.trackOrder'],
        [{ declaration, placement: { state: 'dead', effectiveSeconds: 0 } }, 'transition.boundary.dead.noHandle'],
        [{ declaration, placement: { state: 'shortened', effectiveSeconds: 0.2 } }, 'transition.inspector.status.shortened.material'],
        [{ declaration }, 'transition.inspector.status.unknown']
    ];
    for (const [patch, expected] of cases) {
        const fields = transitionInspectorFields(snapshot(patch));
        assert.equal(fields.status?.key, expected);
        if (patch.block) assert.deepEqual(fields.handles, []);
    }
    assert.equal(transitionInspectorFields(snapshot(handles)).handles.length, 2);
});

test('only directional arrows use symbols; other directions show translated names', () => {
    const panel = readFileSync(new URL('../src/browser/inspector/transition-panel.ts', import.meta.url), 'utf8');
    assert.match(panel, /button\.textContent = direction\.symbol \?\? t\(direction\.labelKey\)/u);
    const arrow = transitionInspectorFields(snapshot({ declaration: { type: 'wipe-left', duration: 0.5 } }));
    assert.deepEqual(arrow.directions.map(direction => direction.symbol), ['←', '→', '↑', '↓']);
    setLanguage('ja');
    try {
        for (const [type, expected] of [['circle-open', ['開く', '閉じる']],
            ['squeeze-h', ['縦につぶす', '横につぶす']]]) {
            const fields = transitionInspectorFields(snapshot({ declaration: { type, duration: 0.5 } }));
            assert.deepEqual(fields.directions.map(direction => direction.symbol ?? t(direction.labelKey)), expected);
        }
    } finally { setLanguage(undefined); }
});

test('all directional families expose every reachable type, including 29 canonical types', () => {
    assert.equal(TRANSITION_FAMILIES.length, 15);
    assert.equal(TRANSITION_VOCABULARY.length, 29);
    const directional = TRANSITION_FAMILIES.filter(family => family.directions.length > 0);
    assert.deepEqual(directional.map(family => family.family).sort(),
        ['wipe', 'slide', 'cover', 'reveal', 'circle', 'squeeze'].sort());
    for (const family of directional) {
        for (const direction of family.directions) {
            const type = transitionDirectionType(family.family, direction);
            assert.equal(type, transitionTypeOf(family.family, direction));
            const fields = transitionInspectorFields(snapshot({ declaration: { type, duration: 0.5 } }));
            assert.equal(fields.directions.length, family.directions.length);
            assert.equal(fields.directions.find(button => button.direction === direction)?.pressed, true);
            for (const button of fields.directions) assert.equal(button.type,
                transitionTypeOf(family.family, button.direction));
        }
    }
    assert.equal(transitionInspectorFields(snapshot({ declaration: { type: 'fade', duration: 0.5 } })).directions.length, 0);
    assert.equal(transitionDirectionType('wipe', 'open'), undefined);
});

test('duration preparation clamps and rounds before the existing write path', () => {
    assert.equal(transitionDurationValue(0.09), 0.1);
    assert.equal(transitionDurationValue(3.01), 3);
    assert.equal(transitionDurationValue(0.126), 0.15);
    assert.equal(transitionDurationValue(null), 0.5);
    for (const invalid of ['', 'abc', 'Infinity']) assert.throws(() => transitionDurationValue(invalid));
    const selected = snapshot({ declaration: { type: 'wipe-left', duration: 0.7 } });
    assert.deepEqual(transitionDurationRequest(selected, 1.23), {
        kind: 'transition-boundary', ref, value: { type: 'wipe-left', duration: 1.25 }
    });
    assert.deepEqual(transitionDirectionRequest(selected, 'right'), {
        kind: 'transition-boundary', ref, value: { type: 'wipe-right', duration: 0.7 }
    });
    assert.equal(transitionDirectionRequest(selected, 'open'), undefined);
    assert.throws(() => transitionDurationRequest(snapshot({ declaration: { type: 'future-kind', duration: 0.5 } }), 1));
});

test('transition deletion follows keyframes and precedes all other targets', () => {
    const input = { keyframe: false, transition: true, gap: true, range: true,
        selection: true, shift: true, autoRipple: true, oneSide: false };
    assert.deepEqual(timelineDeletePlan(input), { target: 'transition', ripple: false });
    assert.deepEqual(timelineDeletePlan({ ...input, keyframe: true }), { target: 'keyframe', ripple: false });
});

test('boundary selection and inspector rendering do not activate a panel or switch tabs', () => {
    const widget = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
    const inspector = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
    const selected = widget.slice(widget.indexOf('protected selectTransitionBoundary('),
        widget.indexOf('protected clearActiveTransitionBoundary('));
    assert.match(selected, /this\.pushSelectionSnapshot\(\)/u);
    assert.match(selected, /this\.videoDurationCache\.has\(videoUri\)/u);
    assert.match(selected, /this\.ensureVideoDurationFetch\(videoUri\)/u);
    assert.match(selected, /!this\.isStillImageCut\(cut\)/u);
    assert.doesNotMatch(selected, /openInspectorPanel|activateWidget|revealWidget/u);
    const changed = inspector.slice(inspector.indexOf('this.toDispose.push(this.model.onChanged('),
        inspector.indexOf('const onLiveValues', inspector.indexOf('this.toDispose.push(this.model.onChanged(')));
    assert.doesNotMatch(changed, /activateWidget|revealWidget|openInspectorPanel/u);
    const reveal = widget.slice(widget.indexOf('public revealActiveTransitionInInspector()'),
        widget.indexOf('protected async applyTransitionOut(', widget.indexOf('public revealActiveTransitionInInspector()')));
    assert.match(reveal, /this\.transitionPicker\?\.close\(\)/u);
    assert.match(reveal, /this\.pushSelectionSnapshot\(\)/u);
    assert.doesNotMatch(reveal, /applySelection|openInspectorPanel/u);
    const snapshotBuilder = widget.slice(widget.indexOf('protected transitionSelectionSnapshot()'),
        widget.indexOf('protected selectTransitionBoundary(', widget.indexOf('protected transitionSelectionSnapshot()')));
    assert.match(snapshotBuilder, /this\.transitionBoundaryCandidates\(\)/u);
    assert.match(snapshotBuilder, /placeBoundary\(/u);
    assert.match(snapshotBuilder, /createTransitionSelection\(/u);
    assert.doesNotMatch(snapshotBuilder, /ensureVideoDurationFetch\(/u);
    const render = inspector.slice(inspector.indexOf('protected render(): void'),
        inspector.indexOf('this.body.appendChild(createSelectionHeader(', inspector.indexOf('protected render(): void')));
    assert.match(render, /if \(snapshot\.kind === 'transition'\)[\s\S]*?this\.renderTransitionSelection\(snapshot\);[\s\S]*?return;/u);
    assert.match(widget, /field === 'locked' && this\.activeBoundary\) this\.pushSelectionSnapshot\(\)/u);
});

test('clip time section no longer includes transition controls', () => {
    const cut = readFileSync(new URL('../src/browser/inspector/sections/cut-sections.ts', import.meta.url), 'utf8');
    const transform = readFileSync(new URL('../src/browser/inspector/sections/transform-fields.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(cut, /cutTransitionFields|transition-type|transition-duration/u);
    assert.doesNotMatch(transform, /cutTransitionFields/u);
});

test('transition panel labels, family, direction and status translate in English', () => {
    setLanguage('en');
    try {
        const fields = transitionInspectorFields(snapshot({ declaration: { type: 'wipe-left', duration: 0.5 },
            placement: { state: 'shortened', effectiveSeconds: 0.25 } }));
        assert.equal(t(fields.headingKey), 'Transition');
        assert.equal(t(fields.type.labelKey), 'Wipe');
        assert.equal(t(fields.directions[0].labelKey), 'Left');
        assert.match(t(fields.status.key), /Shortened/u);
    } finally { setLanguage(undefined); }
});
