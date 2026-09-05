import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
    assert.match(tick, /position = audioSupply\.playbackTime\(fallbackPosition\);\s*(?:\/\/[^\n]*\n\s*)*if \(audioSupply\.debug\(\)\.supply\.gate\.holding\) \{\s*playAnchorPosition = position;\s*playAnchorMs = performance\.now\(\);\s*\}\s*position = renderPlayback\(position\);/u);
});

test('webview の音声表示は degraded、gate、preparing の順で文字列連結を使う', () => {
    const status = section(source, '                const updateAudioStatus = () => {', '                const updateAudio = message => {');
    for (const message of ['一部の音声を再生できません', '音声を待っています', '音声を準備中']) {
        assert.match(status, new RegExp(message, 'u'));
    }
    const degraded = status.indexOf("if (supply?.phase === 'degraded')");
    const gate = status.indexOf('else if (supply && supply.gate && supply.gate.holding)');
    const preparing = status.indexOf("else if (supply?.phase === 'preparing')");
    assert.ok(degraded >= 0 && degraded < gate && gate < preparing);
    assert.match(status, /message = '音声を待っています（' \+ \(supply\.gate\.heldMs \/ 1000\)\.toFixed\(1\) \+ ' 秒）';/u);
    assert.doesNotMatch(status, /\$\{/u);
});
