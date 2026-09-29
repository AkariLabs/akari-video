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

test('clock.tick は音声時計を読んだ直後にゲート中の壁時計を再アンカーし描画する', () => {
    const clock = section(source, '                const clock = {', '                const summaryWithLivePreview =');
    const tick = section(clock, '                    tick(legacyPosition, legacyPlaying) {', '                    updateModel(nextSummary) {');
    // 守っている不変条件は「音声時計を読む → ゲート中なら壁時計を再アンカー → 描画」の順序。
    // 第16項（終端フレームで追加映像だけ消える）の修正で、描画の直前に停止判定用の要求時刻を
    // 捕捉する 1 行が入るため、ゲート節と描画の間にローカル宣言とコメントを許す。順序そのものは
    // 引き続き固定する。
    assert.match(tick, /position = audioSupply\.playbackTime\(fallbackPosition\);\s*(?:\/\/[^\n]*\n\s*)*if \(audioSupply\.debug\(\)\.supply\.gate\.holding\) \{\s*playAnchorPosition = position;\s*playAnchorMs = performance\.now\(\);\s*\}\s*(?:(?:\/\/[^\n]*|const \w+ = position;)\n\s*)*position = renderPlayback\(position\);/u);
});

test('clock.tick の停止判定は提示時刻ではなく要求時刻で行う（第16項のクランプで止まらなくならないこと）', () => {
    const clock = section(source, '                const clock = {', '                const summaryWithLivePreview =');
    const tick = section(clock, '                    tick(legacyPosition, legacyPlaying) {', '                    updateModel(nextSummary) {');
    // renderPlayback は最後の有効フレームへクランプするので、その戻り値は必ず totalDuration 未満に
    // なる。停止判定をそちらで行うと再生が終わらない。
    assert.doesNotMatch(tick, /position = renderPlayback\(position\);\s*if \(position >= totalDuration\)/u);
    assert.match(tick, /const (\w+) = position;\s*position = renderPlayback\(position\);\s*if \(\1 >= totalDuration\) setPlaying\(false, totalDuration\);/u);
});

test('webview の音声表示は gate と再生中の欠落が各 300ms 続いたときだけ出す', () => {
    const status = section(source, '                const updateAudioStatus = () => {', '                const updateAudio = message => {');
    for (const message of ['一部の音声を再生できません', '音声を待っています', '音声を準備中']) {
        assert.match(status, new RegExp(message, 'u'));
    }
    const degraded = status.indexOf("if (supply?.phase === 'degraded')");
    const gate = status.indexOf('else if (supply?.gate?.holding && supply.gate.heldMs >= 300)');
    const preparing = status.indexOf('else if (statusPlaying && missingAudioSinceMs !== null');
    assert.ok(degraded >= 0 && degraded < gate && gate < preparing);
    assert.match(status, /performance\.now\(\) - missingAudioSinceMs >= 300/u);
    assert.match(status, /message = '音声を待っています（' \+ \(supply\.gate\.heldMs \/ 1000\)\.toFixed\(1\) \+ ' 秒）';/u);
    assert.doesNotMatch(status, /\$\{/u);
});

test('cached resume and seek show no status; a missing active source shows preparing after 300 ms', () => {
    let now = 0;
    const audioStatus = { textContent: '', hidden: true };
    const supply = { phase: 'ready', required: ['bgm:bed'], ready: ['bgm:bed'], failed: [],
        noAudio: [], gate: { holding: false, heldMs: 0 } };
    const context = vm.createContext({ document: { getElementById: () => audioStatus }, disposed: false,
        playing: true, audioSupply: { debug: () => ({ playing: false, supply }) }, performance: { now: () => now } });
    vm.runInContext(section(source, '                const audioStatus =', '                const updateAudio = message => {'), context);
    const update = () => { vm.runInContext('updateAudioStatus();', context); return audioStatus.textContent; };
    assert.equal(update(), '');
    now = 800;
    assert.equal(update(), '', 'cached pause/play and seek have no status');
    context.playing = false;
    supply.phase = 'preparing';
    supply.ready = [];
    assert.equal(update(), '', 'paused background preparation stays hidden');
    supply.gate = { holding: true, heldMs: 250 };
    assert.equal(update(), '', 'short gate stays hidden');
    supply.gate.heldMs = 350;
    assert.match(update(), /音声を待っています/u);
    supply.gate = { holding: false, heldMs: 0 };
    context.playing = true;
    now = 1000;
    assert.equal(update(), '');
    now = 1299;
    assert.equal(update(), '');
    now = 1300;
    assert.equal(update(), '音声を準備中 0/1');
    supply.ready = ['bgm:bed'];
    supply.phase = 'ready';
    assert.equal(update(), '');
});
