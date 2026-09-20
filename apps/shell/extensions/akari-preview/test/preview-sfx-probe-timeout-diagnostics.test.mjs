// 尺プローブの打ち切りを診断へ残す（2026-09-19・灰色プレビューの調査で必要になった）。
//
// 背景: 2026-09-02 の preview-perf で「loadedmetadata が永久に来ないプローブが 1 本あるだけで
// 初回描画が永久に待たされる」問題を 8 s 打ち切りで塞いだ（onTimeout）。その打ち切りは
// Console へ 1 回だけ警告し、以降を握りつぶしていた。
//
// 2026-09-19 の実機調査（88 分の会話 + 110 分の BGM を持つ案件で出力プレビューが灰色）では、
// この打ち切りが実際に発火していたが、**どの素材で起きたのかが 1 件ぶんしか分からず**、
// 切り分けがそこで止まった（読み込みのたびに別の素材が打ち切られていた）。
// 初回描画は `await renderFrame(...)` を待つ構造なので、止まった段が「メディア供給」のときに
// 打ち切られた素材が並んでいる必要がある。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = readFileSync(
    fileURLToPath(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url)),
    'utf8'
);

function onTimeoutBody() {
    const from = source.indexOf('onTimeout: src => {');
    assert.ok(from >= 0, 'onTimeout が見つからない');
    const to = source.indexOf('});', from);
    assert.ok(to > from, 'onTimeout の終端が見つからない');
    return source.slice(from, to);
}

test('打ち切られた素材を溜める入れ物がある（重複なし・上限つき）', () => {
    assert.match(source, /const sfxProbeTimeouts = \[\];/u);
    const body = onTimeoutBody();
    assert.match(body, /sfxProbeTimeouts\.length < 12/u, '上限を置く（ログを溢れさせない）');
    assert.match(body, /!sfxProbeTimeouts\.includes\(src\)/u, '同じ素材を二重に記録しない');
    assert.match(body, /sfxProbeTimeouts\.push\(src\)/u);
});

test('打ち切りは全件を診断へ残す（Console の警告は 1 回だけ）', () => {
    const body = onTimeoutBody();
    // 診断への記録は「1 回だけ」のガードより前にあること。後ろだと 2 件目以降が落ちる。
    const noteAt = body.indexOf('__akariPreviewDiag');
    const warnedAt = body.indexOf('if (sfxProbeTimeoutWarned) return;');
    assert.ok(noteAt >= 0, '診断へ記録していない');
    assert.ok(warnedAt >= 0, 'Console 警告の 1 回きりガードが無い');
    assert.ok(
        noteAt < warnedAt,
        '診断への記録が「1 回だけ」のガードより後ろにあると、2 件目以降の素材が残らない'
    );
});

test('診断には打ち切り秒数と素材の URL を入れる', () => {
    const body = onTimeoutBody();
    assert.match(body, /note\('尺プローブ打ち切り（' \+ \(SFX_PROBE_TIMEOUT_MS \/ 1000\)/u);
    assert.match(body, /\+ ' s 超）: ' \+ src/u);
});

test('診断 API が無い環境でも落ちない（webview の初期化順に依存しない）', () => {
    const body = onTimeoutBody();
    assert.match(body, /if \(window\.__akariPreviewDiag\)/u, '存在確認なしで呼ばない');
});

test('Console の文面は「以降は診断ログへ記録」と案内する（握りつぶしと誤解させない）', () => {
    const body = onTimeoutBody();
    assert.match(body, /以降は診断ログへ記録/u);
    assert.doesNotMatch(body, /以降の同種警告は省略/u, '「省略」のままだと記録されていないと読める');
});

test('8 秒の打ち切り自体は残す（2026-09-02 の無限待ち対策を壊さない）', () => {
    assert.match(source, /const SFX_PROBE_TIMEOUT_MS = 8000;/u);
    assert.match(source, /timeoutMs: SFX_PROBE_TIMEOUT_MS/u);
});
