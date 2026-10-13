import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scaleCaptionLookPixels, lookForCaptionAtSize, sanitizeCaptionRunLook,
  rebaseCaptionRuns, splitCaptionRuns, nextCaptionRunId, clearCaptionRunRange,
  joinAdjacentCaptionRuns, anchorToOutput, anchorForCaptionRange, fitCaptionMotionWindow,
  unresolvedRunsForDeletedCaption,
  moveDeletedCaptionRunsToUnresolved,
  splitCaptionLine, mergeCaptionLines,
  planCaptionLookMigration, readCaptionLookV1, validateCaptionsSemantics,
  captionRenderInputFromV1,
  resolveCaptionStylePreset, resolveCaptionWordStyleVars, resolveCaptionStyleForOutput,
  lookForCaptionRow, lookForCaptionRun, applyCaptionRunsToHtml,
  applyWordBookToCaptionsInSource
} from '../lib/index.js';

const row = (text, extra = {}) => ({ id: 'c-0001', start: 0, end: 10, text,
  speaker: null, sourceRef: null, edited: false, src: 's1', ...extra });

test('layout の字幕に大きさを保って当てると size_px が残る', () => {
  const layout = { mode: 'reference-pixel', reference_width_px: 1920,
    reference_height_px: 1080, left_px: 0, width_px: 1000, bottom_px: 0,
    text_align: 'center', max_lines: 1 };
  const target = row('猫', { text_style: { layout, size_px: 80 } });
  const result = lookForCaptionRow(target, {}, { size_px: 120, stroke: { width_px: 6 } },
    { size: 'keep' });
  assert.equal(result.text_style.size_px, 80);
  assert.deepEqual(result.text_style.layout, layout);
  assert.equal(result.text_style.stroke.width_px, 4);
  const conflict = lookForCaptionRow(target, {}, { size_px: 120, reference_height_px: 1920 },
    { size: 'style' });
  assert.equal(conflict.text_style, undefined);
  assert.match(conflict.reason, /layout.*reference_height_px/);
});

test('範囲の換算は行の実効サイズを使い許可外のフォントを通知する', () => {
  const result = lookForCaptionRun(row('猫'), { size_px: 80 },
    { size_px: 120, font_family: 'Example', stroke: { width_px: 6 } });
  assert.equal(result.look.stroke.width_px, 4);
  assert.equal(result.look.font_family, undefined);
  assert.ok(result.notices.length);
});

test('置換にまたがる範囲は新しい差分区間を含めて伸縮する', () => {
  const run = { id: 'r-0001', from: 3, to: 5 };
  assert.deepEqual(rebaseCaptionRuns('これは最高', 'これは最良', [run]).runs,
    [{ ...run, from: 3, to: 5, needs_review: true }]);
  assert.deepEqual(rebaseCaptionRuns('これは最高', 'これは最も高', [run]).runs,
    [{ ...run, from: 3, to: 6, needs_review: true }]);
  assert.deepEqual(rebaseCaptionRuns('これは最高', 'これは最良',
    [{ id: 'r-0002', from: 4, to: 5 }]).removed,
    [{ id: 'r-0002', from: 4, to: 5 }]);
});

test('可逆に移せない強調語は残して通知する', () => {
  const emphasis = [
    { id: 'e-0001', src: 's1', word: '猫', t_start: 0, t_end: 1,
      emotion: 'joy', style_hint: 'color-only' },
    { id: 'e-0002', src: 's1', word: '猫', t_start: 0, t_end: 1,
      emotion: 'joy', style_hint: 'size-pulse', style_preset: 'neon' },
    { id: 'e-0003', src: 's1', word: '猫', t_start: 0, t_end: 11,
      emotion: 'joy', style_hint: 'size-pulse' }
  ];
  const result = planCaptionLookMigration({ captions: [row('猫')], emphasis_words: emphasis }, {});
  assert.deepEqual(result.next.emphasis_words, emphasis);
  assert.deepEqual(result.unresolved, emphasis);
  assert.equal(result.notices.length, 3);
});

test('旧形式だけの描画入力は同じオブジェクトを返す', () => {
  const original = { captions: [row('猫', { style_preset: 'neon',
    runs: [{ from: 0, to: 1, style: { scale: 1.5, stroke: { width_px: 3 } } }] })] };
  assert.equal(captionRenderInputFromV1(original), original);
  const html = '<p class="akari-caption__line">猫</p>';
  assert.match(applyCaptionRunsToHtml(html, '猫', original.captions[0].runs),
    /-webkit-text-stroke:3px/);
});

test('換算: 80px の行へ 120px のスタイルを当てるとグローは保存時 40px、1080 出力で 22.5px', () => {
  const saved = lookForCaptionAtSize({ size_px: 120, glow: { color: '#fff', spread: 60 } }, 80, 1920).look;
  assert.equal(saved.glow.spread, 40);
  const vars = resolveCaptionStyleForOutput(saved, { width: 1080, height: 1080 }).vars;
  assert.match(vars['--caption-text-shadow'], /22\.5px/);
  assert.doesNotMatch(vars['--caption-text-shadow'], /12\.65625px/);
});

test('換算: layout の字幕でも保存済み size_px は消えない', () => {
  assert.equal(lookForCaptionAtSize({ size_px: 120, stroke: { width_px: 6 } }, 80).look.size_px, 80);
});

test('換算: 範囲の scale 1.5 は保存した縁の幅を描画時に 1.5 倍にする', () => {
  const saved = scaleCaptionLookPixels({ size_px: 120, stroke: { width_px: 6 }, scale: 1.5 }, 80);
  assert.equal(saved.stroke.width_px, 4);
  const html = applyCaptionRunsToHtml('<p class="akari-caption__line">猫</p>', '猫',
    [{ id: 'r-0001', from: 0, to: 1, look: saved }]);
  assert.match(html, /-webkit-text-stroke:6px/);
});

test('換算: text_transform は行の look に残る', () => {
  assert.equal(lookForCaptionAtSize({ size_px: 80, text_transform: 'upper' }, 80).look.text_transform, 'upper');
});

test('換算: 範囲の font_family は落として日本語で通知する', () => {
  const result = sanitizeCaptionRunLook({ font_family: 'Example', color: '#fff' });
  assert.equal(result.look.font_family, undefined);
  assert.match(result.notices[0], /フォント/);
});

test('付け替え: 赤い猫と青い犬を白い猫と黒い犬にしても猫の範囲を保つ', () => {
  assert.deepEqual(rebaseCaptionRuns('赤い猫と青い犬', '白い猫と黒い犬',
    [{ id: 'r-0001', from: 2, to: 3 }]).runs[0], { id: 'r-0001', from: 2, to: 3 });
});

test('付け替え: 単語帳の AKARI 置換でも便利の範囲を保つ', () => {
  const source = JSON.stringify({ captions: [row('あかりは便利', { runs: [{ id: 'r-0001', from: 4, to: 6 }] })] });
  const changed = JSON.parse(applyWordBookToCaptionsInSource(source, [{ id: 'c-0001', text: 'AKARIは便利' }]));
  assert.deepEqual(changed.captions[0].runs[0], { id: 'r-0001', from: 6, to: 8 });
});

test('付け替え: LCS の同点候補には needs_review を付ける', () => {
  const result = rebaseCaptionRuns('AB', 'BA', [{ from: 1, to: 2 }]);
  assert.equal(result.runs[0].needs_review, true);
});

test('付け替え: 同じ文字が複製された同点も needs_review にする', () => {
  const result = rebaseCaptionRuns('猫', '猫猫', [{ from: 0, to: 1 }]);
  assert.equal(result.runs[0].needs_review, true);
});

test('分割: spoken の両側 anchor を行の時刻へ切り詰める', () => {
  const run = { id: 'r-0001', from: 0, to: 2, fire: 'spoken',
    anchor: { src: 's1', start: 1, end: 3, domain: 'source' } };
  const split = splitCaptionRuns('猫犬', [run], 1, { start: 0, end: 2 }, { start: 2, end: 4 });
  assert.deepEqual([split.left[0].anchor.start, split.left[0].anchor.end], [1, 2]);
  assert.deepEqual([split.right[0].anchor.start, split.right[0].anchor.end], [2, 3]);
  assert.equal(split.right[0].split_from, 'r-0001');
  assert.notEqual(split.right[0].id, 'r-0001');
});

test('分割: anchor が空の側は shown、fire_was、needs_review を持つ', () => {
  const run = { id: 'r-0001', from: 0, to: 2, fire: 'spoken',
    anchor: { start: 0.5, end: 1, domain: 'source' } };
  const split = splitCaptionRuns('猫犬', [run], 1, { start: 0, end: 2 }, { start: 2, end: 4 });
  assert.equal(split.right[0].anchor, undefined);
  assert.equal(split.right[0].fire, 'shown');
  assert.equal(split.right[0].fire_was, 'spoken');
  assert.equal(split.right[0].needs_review, true);
});

test('結合: ファイル全体の採番で id が衝突しない', () => {
  assert.equal(nextCaptionRunId([{ id: 'r-0001' }, { id: 'r-0002' }]), 'r-0003');
});

test('結合: 色も時刻も違う隣接 run は自動結合されない', () => {
  const runs = [{ from: 0, to: 1, look: { color: '#f00' }, anchor: { start: 0, end: 1 } },
    { from: 1, to: 2, look: { color: '#00f' }, anchor: { start: 1, end: 2 } }];
  assert.equal(joinAdjacentCaptionRuns(runs).length, 2);
});

test('保存経路: 分割後に結合しても run の id と独立した範囲を保つ', () => {
  const original = row('猫犬', { start: 0, end: 2, words: [
    { text: '猫', start: 0, end: 1 }, { text: '犬', start: 1, end: 2 }],
    runs: [{ id: 'r-0001', from: 0, to: 2, look: { color: '#f00' } }] });
  const split = splitCaptionLine(JSON.stringify({ captions: [original] }), 'c-0001', 1, 'c-0002');
  const merged = JSON.parse(mergeCaptionLines(split, ['c-0001', 'c-0002']));
  assert.equal(merged.captions[0].runs.length, 2);
  assert.equal(new Set(merged.captions[0].runs.map(run => run.id)).size, 2);
});

test('行の消失: unresolved_runs 用に旧行の素材と時刻を残す', () => {
  const unresolved = unresolvedRunsForDeletedCaption(row('猫', { start: 2, end: 3,
    runs: [{ id: 'r-0001', from: 0, to: 1 }] }));
  assert.deepEqual(unresolved.map(item => [item.old_src, item.old_start, item.old_end]), [['s1', 2, 3]]);
});

test('行の消失: 純関数で run を unresolved_runs に移し描画対象の行を外す', () => {
  const root = { captions: [row('猫', { runs: [{ id: 'r-0001', from: 0, to: 1 }] })] };
  const next = moveDeletedCaptionRunsToUnresolved(root, 'c-0001');
  assert.equal(root.captions.length, 1);
  assert.equal(next.captions.length, 0);
  assert.equal(next.unresolved_runs[0].old_src, 's1');
});

test('解除: 選んだ文字を行の見た目へ戻すと右側に新 id を付ける', () => {
  const result = clearCaptionRunRange([{ id: 'r-0001', from: 0, to: 5 }], 2, 3);
  assert.deepEqual(result.map(run => [run.from, run.to]), [[0, 2], [3, 5]]);
  assert.equal(result[1].split_from, 'r-0001');
});

const timeline = { segments: [
  { kind: 'src', src: 's1', in: 0, out: 10, speed: 1, outStart: 0, outEnd: 10, cutIndex: 0 },
  { kind: 'src', src: 's2', in: 0, out: 10, speed: 1, outStart: 10, outEnd: 20, cutIndex: 1 }
] };

test('写像: s1 の後の s2 の 2 秒は出力 12 秒', () => {
  assert.equal(anchorToOutput({ src: 's2', start: 2, end: 3, domain: 'source' },
    { src: 's2', start: 0, end: 10 }, timeline)[0].start, 12);
});

test('写像: 同じ素材の 2 回使用は配置ごとに発火する', () => {
  const repeated = { segments: [timeline.segments[0], { ...timeline.segments[0], outStart: 10, outEnd: 20, cutIndex: 1 }] };
  assert.deepEqual(anchorToOutput({ src: 's1', start: 2, end: 3, domain: 'source' },
    { src: 's1', start: 0, end: 10 }, repeated).map(item => item.start), [2, 12]);
});

test('写像: 2 倍速の配置では素材 4 秒を出力 2 秒へ写す', () => {
  const fast = { segments: [{ kind: 'src', src: 's1', in: 0, out: 10,
    speed: 2, outStart: 0, outEnd: 5, cutIndex: 0 }] };
  assert.equal(anchorToOutput({ src: 's1', start: 4, end: 5, domain: 'source' },
    { src: 's1', start: 0, end: 10 }, fast)[0].start, 2);
});

test('写像: カットで消えた区間は shown と診断へ落とす', () => {
  const result = anchorToOutput({ src: 's1', start: 11, end: 12, domain: 'source' },
    { src: 's1', start: 0, end: 12 }, timeline)[0];
  assert.equal(result.fire, 'shown');
  assert.equal(result.diagnostics[0].code, 'captions.run.anchor-cut');
});

test('写像: output domain は素材の配置を見ない', () => {
  const result = anchorToOutput({ start: 3, end: 4, domain: 'output' },
    { start: 2, end: 5, time_domain: 'output' }, { segments: [] })[0];
  assert.equal(result.start, 3);
});

test('写像: 表示窓より前の発火は窓の始まりへ寄せ、後なら動かさない', () => {
  const before = anchorToOutput({ src: 's1', start: 0, end: 1, domain: 'source' },
    { src: 's1', start: 2, end: 5 }, timeline)[0];
  const after = anchorToOutput({ src: 's1', start: 6, end: 7, domain: 'source' },
    { src: 's1', start: 2, end: 5 }, timeline)[0];
  assert.equal(before.start, 2);
  assert.equal(after.start, undefined);
  assert.equal(after.diagnostics[0].code, 'captions.run.anchor-window');
});

test('移行: emphasis 3 件、runs v0、style_preset を 2 回移しても増えない', () => {
  const catalog = { sample: { style: { color: '#fff', size_px: 80 } } };
  const fixture = { captions: [row('猫犬鳥', { style_preset: 'sample',
    runs: [{ from: 0, to: 1, style: { color: '#f00' }, animation: { in: { id: 'pop' } } }] })],
    emphasis_words: ['猫', '犬', '鳥'].map((word, n) => ({ id: `e-000${n + 1}`, src: 's1',
      t_start: n, t_end: n + 1, word, emotion: 'joy' })) };
  const first = planCaptionLookMigration(fixture, catalog).next;
  const second = planCaptionLookMigration(first, catalog).next;
  assert.deepEqual(second, first);
  assert.equal(first.captions[0].runs.length, 4);
  assert.equal(first.emphasis_words.length, 0);
});

test('移行: runs v0 の animation は dormant_animation で描画用 motion にしない', () => {
  const result = planCaptionLookMigration({ captions: [row('猫', {
    runs: [{ from: 0, to: 1, animation: { in: { id: 'pop' } } }] })] }, {}).next;
  assert.equal(result.captions[0].runs[0].motion, undefined);
  assert.deepEqual(result.captions[0].runs[0].dormant_animation, { in: { id: 'pop' } });
});

test('移行: 行 preset の前後で render-cut 用 CSS 変数とテキストを保つ', () => {
  const catalog = { sample: { style: { color: '#fff', size_px: 80, reference_height_px: 1920,
    glow: { color: '#f0f', spread: 6 }, animation: { loop: { id: 'float' } } } } };
  const original = row('猫です', { style_preset: 'sample', text_style: { color: '#f00' } });
  const before = resolveCaptionStylePreset(original, catalog).record;
  const migrated = planCaptionLookMigration({ captions: [original] }, catalog).next.captions[0];
  const output = { width: 1080, height: 1080 };
  assert.deepEqual(resolveCaptionWordStyleVars(migrated.text_style, output),
    resolveCaptionWordStyleVars(before.text_style, output));
  assert.equal(migrated.text, original.text);
  assert.deepEqual(migrated.text_style.animation, before.text_style.animation);
  assert.equal(migrated.style_sources.motion.kind, 'builtin');
});

test('reader: 旧形式の preset と run style を値へ投影する', () => {
  const result = readCaptionLookV1({ captions: [row('猫', { style_preset: 'sample',
    runs: [{ from: 0, to: 1, style: { color: '#f00' } }] })] },
  { sample: { style: { color: '#fff' } } });
  assert.equal(result.captions[0].text_style.color, '#fff');
  assert.equal(result.captions[0].runs[0].look.color, '#f00');
});

test('発火: words と text が一致する範囲だけ実測時刻を使う', () => {
  const result = anchorForCaptionRange(row('猫犬', { words: [
    { text: '猫', start: 1, end: 2 }, { text: '犬', start: 2, end: 3 }] }), 1, 2);
  assert.deepEqual([result.anchor.start, result.anchor.end], [2, 3]);
});

test('発火: display_text が異なり対応を写せなければ anchor を付けない', () => {
  const result = anchorForCaptionRange(row('あかり', { display_text: 'AKARI',
    words: [{ text: 'あかり', start: 1, end: 2 }] }), 1, 4);
  assert.equal(result.anchor, undefined);
  assert.equal(result.diagnostics[0].code, 'captions.run.anchor-unmapped');
});

test('発火: 単語帳の表示置換後も一致する便利の実測時刻を使う', () => {
  const result = anchorForCaptionRange(row('あかりは便利', { display_text: 'AKARIは便利',
    words: [{ text: 'あかり', start: 0, end: 1 }, { text: 'は', start: 1, end: 2 },
      { text: '便利', start: 2, end: 3 }] }), 6, 8);
  assert.deepEqual([result.anchor.start, result.anchor.end], [2, 3]);
});

test('発火: 短い表示窓では in と out を同比率で縮めて loop を止める', () => {
  assert.deepEqual(fitCaptionMotionWindow(0, 1, 2, 2),
    { inSeconds: 0.5, outSeconds: 0.5, loopSeconds: 0, active: true });
});

test('検証: 範囲外、id 重複、anchor 無し spoken は error', () => {
  const diagnostics = validateCaptionsSemantics({ captions: { captions: [row('猫', { runs: [
    { id: 'r-0001', from: 0, to: 2 }, { id: 'r-0001', from: 0, to: 1, fire: 'spoken' }
  ] })] } });
  assert.deepEqual(new Set(diagnostics.filter(item => item.severity === 'error').map(item => item.code)),
    new Set(['captions.run.range', 'captions.run.id', 'captions.run.anchor']));
});

test('検証: 未解決の範囲との id 重複も error', () => {
  const run = { id: 'r-0001', from: 0, to: 1 };
  const diagnostics = validateCaptionsSemantics({ captions: { captions: [row('猫', { runs: [run] })],
    unresolved_runs: [{ run, old_caption_id: 'c-0002', old_text: '猫', old_src: 's1', old_start: 0,
      old_end: 1, reason: '行が消えた' }] } });
  assert.equal(diagnostics.filter(item => item.code === 'captions.run.id').length, 2);
});

test('検証: anchor が写せないと warning', () => {
  const diagnostics = validateCaptionsSemantics({ captions: { captions: [row('猫', {
    runs: [{ from: 0, to: 1, fire: 'spoken', anchor: { src: 's1', start: 1, end: 2, domain: 'source' } }]
  })] }, timeline: { segments: [] } });
  assert.equal(diagnostics[0].severity, 'warning');
  assert.equal(diagnostics[0].code, 'captions.run.anchor-cut');
});

test('検証: GPU で描けない motion は経路だけ error', () => {
  const fixture = { captions: [row('猫', { runs: [{ from: 0, to: 1,
    motion: { in: { id: 'glitch' } } }] })] };
  assert.equal(validateCaptionsSemantics({ captions: fixture, path: 'gpu', gpuMotionIds: new Set(['pop']) })[0].code,
    'captions.style.unsupported-path');
  assert.equal(validateCaptionsSemantics({ captions: fixture, path: 'preview' }).length, 0);
});

test('検証: 依存素材の欠落は書き出しで error、hash 違いは warning', () => {
  const fixture = { captions: [row('猫', { style_sources: { look: {
    kind: 'library', id: 'sample', original_hash: 'a', applied_hash: 'b',
    requires: [{ id: 'font-1', version: '1', hash: 'old' }] } } })] };
  assert.equal(validateCaptionsSemantics({ captions: fixture, path: 'render-cut', assetHashes: {} })[0].severity,
    'error');
  assert.equal(validateCaptionsSemantics({ captions: fixture, path: 'render-cut',
    assetHashes: { 'font-1': 'new' } })[0].severity, 'warning');
});
