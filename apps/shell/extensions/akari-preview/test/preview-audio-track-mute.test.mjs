import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const section = (text, start, end) => {
    const from = text.indexOf(start);
    const to = text.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `${start} … ${end}`);
    return text.slice(from, to);
};
const initialization = section(source, '            const initialHiddenTracksByScope =', '            let globalMuted =');
const declared = section(source, '            const syncDeclaredTrackStates =', '            const applyIncrementalModel =');
const single = section(source,
    "                if (message && message.type === 'akari-preview-set-track-visibility-v2')",
    "                if (message && message.type === 'akari-preview-set-track-visibility-v2-bulk')");
const bulk = section(source,
    "                if (message && message.type === 'akari-preview-set-track-visibility-v2-bulk')",
    "                if (message && message.type === 'akari-preview-set-captions-visibility'");
const creation = section(source, '                const normalizedMutedTracks =',
    '                audioSupply = createAudioSupplyForSummary');
const receiver = section(source, '                const setMutedTracks = muted =>',
    '                const pendingAudio =');
const cleanup = section(source, '                    if (window.akari.frameEngineSetMutedTracks ===',
    '                    clearInterval(audioStatusTimer);');
const plain = value => JSON.parse(JSON.stringify(value));

function previewContext(initial = {}) {
    const calls = [];
    const legacy = [];
    const context = vm.createContext({
        initial, summary: {},
        window: { akari: { previewAudio: { setMutedTracks: (...args) => legacy.push(args) } } },
        tick() {},
    });
    vm.runInContext(initialization + declared, context);
    context.window.akari.frameEngineSetMutedTracks = value => calls.push(plain(value));
    const receive = message => {
        context.message = message;
        vm.runInContext('(function () {\n' + single + bulk + '\n})();', context);
    };
    return { context, calls, legacy, receive };
}

test('初期ミュートは後から起動する frame-engine が読める状態として保存する', () => {
    const { context } = previewContext({ mutedTracksByScope: { cuts: [3], audio: [5] }, allTracksMutedScopes: ['cuts'] });
    assert.deepEqual(plain(context.window.akari.frameEngineMutedTracks), {
        cuts: [3], audio: [5], allCuts: true, allAudio: false,
    });
    assert.match(initialization, /syncFrameEngineMutedTracks\(\);/u);
});

test('v2-bulk は cuts と audio の両スコープを同期し旧音声経路の呼び出しを保つ', () => {
    const { context, calls, legacy, receive } = previewContext();
    receive({ type: 'akari-preview-set-track-visibility-v2-bulk', mutedCuts: [1, 4], mutedAudio: [7] });
    const expected = { cuts: [1, 4], audio: [7], allCuts: false, allAudio: false };
    assert.deepEqual(calls, [expected]);
    assert.deepEqual(plain(context.window.akari.frameEngineMutedTracks), expected);
    assert.deepEqual([...legacy[0][0]], [7]);
    assert.equal(legacy[0][1], false);
});

test('v2 単体と全トラック指定は状態を同期し syncDeclaredTrackStates でも両スコープを貼り直す', () => {
    const { context, calls, receive } = previewContext();
    receive({ type: 'akari-preview-set-track-visibility-v2', scope: 'cuts', track: 2, muted: true });
    receive({ type: 'akari-preview-set-track-visibility-v2', scope: 'audio', track: null, muted: true });
    assert.deepEqual(calls.at(-1), { cuts: [2], audio: [], allCuts: false, allAudio: true });
    context.summary = { tracks: { cuts: [{ ref: 6, muted: true }], audio: [{ ref: 8, muted: true }] } };
    vm.runInContext('syncDeclaredTrackStates();', context);
    assert.deepEqual(calls.at(-1), { cuts: [6], audio: [8], allCuts: false, allAudio: true });
});

test('supply 作成と rebuild は同じ初期化で橋の最新値を優先し、不正値は既定値にする', () => {
    const calls = [];
    const context = vm.createContext({
        initial: { mutedTracksByScope: { cuts: [2], audio: [4] }, allTracksMutedScopes: ['audio'] },
        window: { akari: {} }, rate: 1, audioDeclarationsForSummary: () => ({}),
        engine: { createPreviewAudioSupply: () => ({ setRate() {}, setMutedTracks: value => calls.push(plain(value)) }) },
    });
    vm.runInContext(creation + 'createAudioSupplyForSummary({}, [], 10);', context);
    assert.deepEqual(calls.at(-1), { cuts: [2], audio: [4], allCuts: false, allAudio: true });
    context.window.akari.frameEngineMutedTracks = { cuts: [9], audio: [1], allCuts: true, allAudio: false };
    vm.runInContext('createAudioSupplyForSummary({}, [], 10);', context);
    assert.deepEqual(calls.at(-1), { cuts: [9], audio: [1], allCuts: true, allAudio: false });
    context.window.akari.frameEngineMutedTracks = { cuts: {}, audio: 2, allCuts: 1, allAudio: 'true' };
    vm.runInContext('createAudioSupplyForSummary({}, [], 10);', context);
    assert.deepEqual(calls.at(-1), { cuts: [], audio: [], allCuts: false, allAudio: false });
    const rebuild = section(source, '                const applyEngineSummary =', '                const queueEngineSummaryUpdate =');
    assert.match(rebuild, /previousAudioSupply\.dispose\(\);/u);
    assert.match(rebuild, /audioSupply = createAudioSupplyForSummary\(nextSummary, nextCuts, nextDuration\);/u);
});

test('公開した受信関数は検証済み値を供給し、破棄後は無視して beforeunload で自分だけ削除する', () => {
    const calls = [];
    const context = vm.createContext({
        window: { akari: {} }, disposed: false, updateAudioStatus() {},
        audioSupply: { setMutedTracks: value => calls.push(plain(value)) },
    });
    const normalize = section(creation, '                const normalizedMutedTracks =', '                const createAudioSupplyForSummary =');
    vm.runInContext(normalize + receiver, context);
    context.window.akari.frameEngineSetMutedTracks({ cuts: [3], allAudio: true });
    assert.deepEqual(calls, [{ cuts: [3], audio: [], allCuts: false, allAudio: true }]);
    context.disposed = true;
    context.window.akari.frameEngineSetMutedTracks({ cuts: [] });
    assert.equal(calls.length, 1);
    const replacement = () => {};
    const original = context.window.akari.frameEngineSetMutedTracks;
    context.window.akari.frameEngineSetMutedTracks = replacement;
    vm.runInContext(cleanup, context);
    assert.equal(context.window.akari.frameEngineSetMutedTracks, replacement);
    context.window.akari.frameEngineSetMutedTracks = original;
    vm.runInContext(cleanup, context);
    assert.equal(context.window.akari.frameEngineSetMutedTracks, undefined);
    const unload = section(source, "                window.addEventListener('beforeunload', () => {", '                    clearInterval(audioStatusTimer);');
    assert.ok(unload.includes(cleanup));
});

test('ミュートの橋に追加した埋め込み JS はテンプレート補間を含まない', () => {
    for (const text of [initialization, declared, single, bulk, creation, receiver, cleanup]) {
        assert.doesNotMatch(text, /\$\{/u);
    }
});
