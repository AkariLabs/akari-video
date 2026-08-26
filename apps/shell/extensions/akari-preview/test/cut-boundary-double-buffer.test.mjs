import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const compiled = readFileSync(
    join(here, '..', 'lib', 'browser', 'akari-preview-open-handler.js'),
    'utf8'
);

function extractTemplate(methodName) {
    const methodAt = compiled.lastIndexOf(`${methodName}()`);
    assert.notEqual(methodAt, -1, `${methodName}() is missing`);
    const tick = compiled.indexOf('`', methodAt);
    assert.notEqual(tick, -1, `${methodName}() template is missing`);
    let index = tick + 1;
    let output = '';
    while (index < compiled.length) {
        const character = compiled[index];
        if (character === '\\') {
            const next = compiled[index + 1];
            if (next === 'n') output += '\n';
            else if (next === 't') output += '\t';
            else if (next === 'r') output += '\r';
            else output += next;
            index += 2;
            continue;
        }
        if (character === '`') break;
        if (character === '$' && compiled[index + 1] === '{') {
            let braces = 1;
            index += 2;
            while (index < compiled.length && braces > 0) {
                const current = compiled[index];
                if (current === '\\') { index += 2; continue; }
                if (current === '{') braces += 1;
                else if (current === '}') braces -= 1;
                index += 1;
            }
            output += '0';
            continue;
        }
        output += character;
        index += 1;
    }
    return output;
}

const bootstrap = extractTemplate('previewBootstrapScript');
const extractBetween = (startMarker, endMarker) => {
    const start = bootstrap.indexOf(startMarker);
    const end = bootstrap.indexOf(endMarker, start);
    assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
    assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
    return bootstrap.slice(start, end);
};

const simulateBoundary = preloadComplete => {
    const state = {
        active: { id: 'preview-video', sourceId: 'take-a' },
        standby: { id: 'standby-video', sourceId: 'take-b' },
        sourceSwapPending: false,
        srcAssignments: 0,
        loadCalls: 0
    };
    if (preloadComplete) {
        [state.active, state.standby] = [state.standby, state.active];
        state.active.id = 'preview-video';
        state.standby.id = 'standby-video';
    } else {
        state.sourceSwapPending = true;
        state.active.sourceId = 'take-b';
        state.srcAssignments += 1;
        state.loadCalls += 1;
    }
    return state;
};

test('standby media and generated bootstrap are wired and syntactically valid', () => {
    assert.match(compiled, /id="standby-video" data-akari-playback-role="standby"/u);
    assert.match(bootstrap, /const CUT_PRELOAD_LEAD_SECONDS = 0\.75;/u);
    assert.match(bootstrap, /const SAME_SOURCE_PRESEEK_THRESHOLD_SECONDS = 0\.5;/u);
    assert.match(bootstrap, /if \(standbyPreloadKey === key\) return;/u);
    assert.match(bootstrap, /preloadUpcomingCut\(outputTime\)/u);
    assert.doesNotThrow(() => new vm.Script(bootstrap, { filename: 'preview-bootstrap.js' }));
});

test('completed preload promotes the standby element without assigning src or calling load', () => {
    const activateBody = extractBetween(
        'const activatePreloadedSegment = (index, segment, target) => {',
        '\n            let currentTransitionVideoSourceId = null;'
    );
    assert.match(activateBody, /standbyPreloadReadyKey !== key/u);
    assert.match(activateBody, /video = standbyVideo;[\s\S]*standbyVideo = outgoingVideo;/u);
    assert.match(activateBody, /currentVideoSourceId = currentStandbyVideoSourceId;/u);
    assert.match(activateBody, /window\.akari\.activateStandbyVideoElement\(video, standbyVideo\)/u);
    assert.doesNotMatch(activateBody, /\.src\s*=|\.load\(/u);

    const state = simulateBoundary(true);
    assert.equal(state.active.sourceId, 'take-b');
    assert.equal(state.srcAssignments, 0);
    assert.equal(state.loadCalls, 0);
    assert.equal(state.sourceSwapPending, false);
});

test('incomplete preload keeps the current source-swap fallback', () => {
    const enterBody = extractBetween(
        'const enterSegment = index => {',
        '\n            const stopAtNaturalEnd = () => {'
    );
    const fallbackBody = extractBetween(
        'const applySegmentSource = (segment, onReady) => {',
        '\n            const primeStandbySegment = (index, segment) => {'
    );
    assert.match(enterBody, /if \(activatedPreload\)[\s\S]*else if \(!applySegmentSource\(segment, seekAndResume\)\)/u);
    assert.match(fallbackBody, /sourceSwapPending = true;/u);
    assert.match(fallbackBody, /video\.src = nextUrl;/u);
    assert.match(fallbackBody, /video\.load\(\);/u);

    const state = simulateBoundary(false);
    assert.equal(state.active.sourceId, 'take-b');
    assert.equal(state.srcAssignments, 1);
    assert.equal(state.loadCalls, 1);
    assert.equal(state.sourceSwapPending, true);
});
