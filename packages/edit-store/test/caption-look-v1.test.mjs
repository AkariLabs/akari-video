import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  scaleCaptionLookPixels, lookForCaptionAtSize, sanitizeCaptionRunLook,
  rebaseCaptionRuns, splitCaptionRuns, nextCaptionRunId, clearCaptionRunRange, resolveCaptionRuns,
  anchorToOutput, anchorForCaptionRange, fitCaptionMotionWindow, buildTimelineMap,
  unresolvedRunsForDeletedCaption,
  moveDeletedCaptionRunsToUnresolved,
  splitCaptionLine, mergeCaptionLines,
  planCaptionLookMigration, readCaptionLookV1, validateCaptionsSemantics, renderableCaptionRuns,
  captionRenderInputFromV1, nextEmphasisWordId,
  resolveCaptionStylePreset, resolveCaptionWordStyleVars, resolveCaptionStyleForOutput,
  lookForCaptionRow, lookForCaptionRun, applyCaptionRunsToHtml,
  applyWordBookToCaptionsInSource, captionValueHash, captionEffectiveSize,
  CAPTION_DEFAULT_SIZE_PX, parseCaptions, insertCaptionLine
} from '../lib/index.js';

const row = (text, extra = {}) => ({ id: 'c-0001', start: 0, end: 10, text,
  speaker: null, sourceRef: null, edited: false, src: 's1', ...extra });

test('移行済みと同じ強調を旧い入口で三回足しても run は一件のまま', () => {
  const emphasis = { id: 'e-0001', src: 's1', word: '猫', t_start: 1, t_end: 2,
    emotion: 'surprise', style_hint: 'one-char-bang' };
  let document = planCaptionLookMigration({ captions: [row('猫')], emphasis_words: [emphasis] }, {}).next;
  for (let repeat = 0; repeat < 3; repeat++) {
    document.emphasis_words = [structuredClone(emphasis)];
    assert.equal(readCaptionLookV1(document, {}).captions[0].runs.length, 1);
    document = planCaptionLookMigration(document, {}).next;
    assert.equal(document.captions[0].runs.length, 1);
    assert.deepEqual(document.emphasis_words, []);
  }
  document.emphasis_words = [{ ...emphasis, emotion: 'anger' }];
  document = planCaptionLookMigration(document, {}).next;
  assert.equal(document.captions[0].runs.length, 2);
});

test('未解決 run の id も数えて読みと移行が同じ次の id を振る', () => {
  const document = { captions: [row('猫')], emphasis_words: [{ id: 'e-0001', src: 's1',
    word: '猫', t_start: 1, t_end: 2, emotion: 'surprise', style_hint: 'one-char-bang' }],
    unresolved_runs: [{ run: { id: 'r-0009', from: 0, to: 1, look: { color: '#ffffff' } } }] };
  const read = readCaptionLookV1(document, {}).captions[0].runs[0].id;
  const migrated = planCaptionLookMigration(document, {}).next.captions[0].runs[0].id;
  assert.equal(read, 'r-0010');
  assert.equal(migrated, read);
});

test('未解決 run の出所 id と衝突する強調は読み・移行・描画入力で同じ番号を振る', () => {
  const emphasis = { id: 'e-0001', src: 's1', word: '猫', t_start: 1, t_end: 2,
    emotion: 'surprise', style_hint: 'one-char-bang' };
  const document = { captions: [row('猫', { runs: [{ id: 'r-0001', from: 0, to: 1,
    look: { color: '#ffffff' } }] })], emphasis_words: [emphasis],
    unresolved_runs: [{ run: { id: 'r-0009', from: 0, to: 1, migrated_from: 'e-0001' } }] };
  const read = readCaptionLookV1(document, {}).captions[0].runs[1].migrated_from;
  const migrated = planCaptionLookMigration(document, {}).next.captions[0].runs[1].migrated_from;
  const rendered = captionRenderInputFromV1(document).emphasis_words[0].id;
  assert.equal(read, 'e-0002');
  assert.equal(migrated, read);
  assert.equal(rendered, read);
});

test('壊れ気味の旧強調語も描画入力へ安全に戻す', () => {
  const good = { id: 'e-0001', src: 's1', word: '猫', t_start: 0.7, t_end: 1.2,
    emotion: 'surprise', style_hint: 'one-char-bang' };
  const line = { id: 'c-0001', src: 's1', start: 0, end: 2, text: '今日は猫の話',
    words: [{ text: '今日', start: 0, end: 0.3 }, { text: 'は', start: 0.3, end: 0.7 },
      { text: '猫', start: 0.7, end: 1.2 }, { text: 'の', start: 1.2, end: 1.4 },
      { text: '話', start: 1.4, end: 2 }] };
  const other = { ...good, word: '話', t_start: 1.4, t_end: 2 };
  const noId = ({ id, ...value }) => value;
  const cases = [
    { words: [null, good], expected: [null, 'e-0001'] },
    { words: ['x', good], expected: [null, 'e-0001'] },
    { words: {}, expected: {} },
    { words: 'text', expected: 'text' },
    { words: null, expected: null },
    { words: [noId(good), noId(other)], expected: [null, 'e-0001'] },
    { words: [{ ...good, id: 'x' }, { ...other, id: 'x' }], expected: ['x', 'e-0001'] },
    { words: [null, good], line: { ...line, runs: [{ id: 'r-0001', from: 0, to: 2,
      look: { color: '#ff0000' } }] }, expected: [null, 'e-0001'] },
    { words: [good, { ...other }], line: { ...line, runs: [null] }, expected: ['e-0001', 'e-0002'] },
    { words: [good, { ...other }], line: { ...line, runs: {} }, expected: ['e-0001', 'e-0002'] },
    { words: [good, { ...other }], rows: [line, null], expected: ['e-0001', 'e-0002'] }
  ];
  for (const [index, item] of cases.entries()) {
    const root = { captions: item.rows ?? [item.line ?? line], emphasis_words: item.words };
    let actual;
    assert.doesNotThrow(() => { actual = captionRenderInputFromV1(root); });
    if (Array.isArray(item.expected)) assert.deepEqual(actual.emphasis_words.map(word => word?.id ?? null), item.expected,
      `例 ${index + 1}`);
    else assert.deepEqual(actual.emphasis_words, item.expected, `例 ${index + 1}`);
    if (index === 8 || index === 9) assert.deepEqual(actual.captions[0].runs, item.line.runs);
    if (index === 10) assert.equal(actual.captions[1], null);
    if (index < 5) assert.equal(actual, root);
  }
});

test('壊れた行や run を飛ばして読める強調 id だけを避ける', () => {
  const base = { id: 'c-0001', text: '猫', start: 0, end: 1 };
  const inputs = [
    { captions: [base], emphasis_words: [null, { id: 'e-0001' }] },
    { captions: [base], emphasis_words: {} },
    { emphasis_words: [{ id: 'e-0001' }] },
    { captions: [{ ...base, runs: [null, { migrated_from: 'e-0001' }] }] },
    { captions: [{ ...base, runs: {} }] },
    { captions: [null, base] },
    { captions: [base], unresolved_runs: [null, {}, { run: null },
      { run: { migrated_from: 'e-0001' } }] }
  ];
  assert.deepEqual(inputs.map(nextEmphasisWordId),
    ['e-0002', 'e-0001', 'e-0002', 'e-0002', 'e-0001', 'e-0001', 'e-0002']);
  for (const root of inputs) {
    assert.doesNotThrow(() => readCaptionLookV1(root, {}));
    assert.doesNotThrow(() => planCaptionLookMigration(root, {}));
  }
});

test('v1 run を描画へ戻しても配列でない強調語は触らない', () => {
  const root = { captions: [row('猫', { runs: [{ id: 'r-0001', from: 0, to: 1,
    look: { color: '#ff0000' } }] })], emphasis_words: { old: true } };
  const actual = captionRenderInputFromV1(root);
  assert.deepEqual(actual.emphasis_words, { old: true });
  assert.equal(actual.captions[0].runs[0].style.color, '#ff0000');
});

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

test('移行済み強調の id は再利用せず衝突した新しい強調も消さない', () => {
  const first = planCaptionLookMigration({ captions: [row('猫話')], emphasis_words: [
    { id: 'e-0001', src: 's1', word: '猫', t_start: 0, t_end: 1,
      emotion: 'joy', style_hint: 'size-pulse' }
  ] }, {}).next;
  assert.equal(nextEmphasisWordId(first), 'e-0002');
  first.emphasis_words.push({ id: 'e-0001', src: 's1', word: '話', t_start: 0, t_end: 1,
    emotion: 'joy', style_hint: 'size-pulse' });
  const second = planCaptionLookMigration(first, {});
  assert.match(second.notices.join(' '), /e-0001.*e-0002/);
  assert.ok(second.next.emphasis_words.some(item => item.word === '話')
    || second.next.captions.some(item => item.runs?.some(run => run.migrated_from === 'e-0002')));
  const legacy = captionRenderInputFromV1(second.next);
  assert.equal(new Set(legacy.emphasis_words.map(item => item.id)).size, legacy.emphasis_words.length);
});

test('描画に戻す強調語の id は移行前後で同じ側を振り直す', () => {
  const original = { captions: [row('猫話')], emphasis_words: [
    { id: 'e-0001', src: 's1', word: '猫', t_start: 0, t_end: 1,
      emotion: 'joy', style_hint: 'size-pulse' }
  ] };
  const once = planCaptionLookMigration(original, {}).next;
  for (let number = 2; number <= 5; number++) once.emphasis_words.push({
    id: `e-000${number}`, src: 's1', word: `未使用${number}`, t_start: 0, t_end: 1,
    emotion: 'joy', style_hint: 'size-pulse'
  });
  once.emphasis_words.push({ id: 'e-0001', src: 's1', word: '話', t_start: 0, t_end: 1,
    emotion: 'joy', style_hint: 'size-pulse' });
  const ids = value => captionRenderInputFromV1(value).emphasis_words
    .filter(item => item.word === '猫' || item.word === '話')
    .map(item => `${item.id}:${item.word}`);
  const before = ids(once);
  const after = ids(planCaptionLookMigration(once, {}).next);
  assert.deepEqual(before, ['e-0001:猫', 'e-0006:話']);
  assert.deepEqual(after, before);
});

test('旧い強調の採番は未解決 run の出所 id も避ける', () => {
  assert.equal(nextEmphasisWordId({ captions: [row('猫')], emphasis_words: [{ id: 'e-0001' }],
    unresolved_runs: [{ run: { id: 'r-0001', from: 0, to: 1, migrated_from: 'e-0002' } }] }), 'e-0003');
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

test('換算: size_px と reference_height_px は範囲から落としても通知しない', () => {
  const result = sanitizeCaptionRunLook({ size_px: 80, reference_height_px: 1920, color: '#fff' });
  assert.deepEqual(result.omitted, ['size_px', 'reference_height_px']);
  assert.deepEqual(result.notices, []);
  assert.equal(captionEffectiveSize(row('猫'), {}), CAPTION_DEFAULT_SIZE_PX);
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

test('付け替え: 単語帳の「あかり」範囲を AKARI 全体へ写して要確認にする', () => {
  const source = JSON.stringify({ captions: [row('あかりは便利', { runs: [{ id: 'r-0001', from: 0, to: 3 }] })] });
  const changed = JSON.parse(applyWordBookToCaptionsInSource(source, [{ id: 'c-0001', text: 'AKARIは便利' }]));
  assert.deepEqual(changed.captions[0].runs[0],
    { id: 'r-0001', from: 0, to: 5, needs_review: true });
});

test('付け替え: 純粋な削除の内側だけを外し置換は残す', () => {
  const run = [{ id: 'r-0001', from: 0, to: 3 }];
  assert.equal(rebaseCaptionRuns('あかり', '', run, { mode: 'project' }).removed.length, 1);
  assert.deepEqual(rebaseCaptionRuns('あかり', 'AKARI', run, { mode: 'project' }).runs[0],
    { ...run[0], from: 0, to: 5, needs_review: true });
});

test('付け替え: LCS の同点候補には needs_review を付ける', () => {
  const result = rebaseCaptionRuns('AB', 'BA', [{ from: 1, to: 2 }]);
  assert.equal(result.runs[0].needs_review, true);
});

test('付け替え: 共通の先頭が確定した後の同じ文字の追加は要確認にしない', () => {
  const result = rebaseCaptionRuns('猫', '猫猫', [{ from: 0, to: 1 }]);
  assert.equal(result.runs[0].needs_review, undefined);
});

test('付け替え: 「すごい」の直後に「い」を足しても範囲と確認状態を保つ', () => {
  assert.deepEqual(rebaseCaptionRuns('すごい', 'すごいい',
    [{ id: 'r-0001', from: 0, to: 3 }]).runs,
  [{ id: 'r-0001', from: 0, to: 3 }]);
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

test('採番: r-0001 と r-0003 があれば次は r-0004', () => {
  assert.equal(nextCaptionRunId([{ id: 'r-0001' }, { id: 'r-0003' }]), 'r-0004');
  assert.equal(nextCaptionRunId([{ id: 'r-9999' }]), 'r-10000');
});

test('採番: 未解決の r-0009 があれば分割の次は r-0010', () => {
  const original = row('猫犬', { start: 0, end: 2, words: [
    { text: '猫', start: 0, end: 1 }, { text: '犬', start: 1, end: 2 }],
  runs: [{ id: 'r-0001', from: 0, to: 2 }] });
  const source = { captions: [original], unresolved_runs: [{ run: { id: 'r-0009', from: 0, to: 1 },
    old_caption_id: 'old', old_text: '猫', old_src: 's1', old_start: 0, old_end: 1, reason: '移動' }] };
  const split = JSON.parse(splitCaptionLine(JSON.stringify(source), 'c-0001', 1, 'c-0002'));
  assert.equal(split.captions[1].runs[0].id, 'r-0010');
  assert.equal(clearCaptionRunRange([{ id: 'r-0001', from: 0, to: 3 }], 1, 2,
    [source.captions[0].runs[0], source.unresolved_runs[0].run])[1].id, 'r-0010');
});

test('採番: reader の emphasis 投影も未解決 r-0009 の後を使う', () => {
  const root = { captions: [row('猫')],
    emphasis_words: [{ id: 'e-0001', src: 's1', word: '猫', t_start: 0, t_end: 1, emotion: 'joy' }],
    unresolved_runs: [{ run: { id: 'r-0009', from: 0, to: 1 } }] };
  assert.equal(readCaptionLookV1(root, {}).captions[0].runs[0].id, 'r-0010');
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

test('保存経路: AKARI の範囲は表示から原文への分割と結合でも消えない', () => {
  const original = row('あかりは便利', { start: 0, end: 2, display_text: 'AKARIは便利',
    words: [{ text: 'あかり', start: 0, end: 1 }, { text: 'は便利', start: 1, end: 2 }],
    runs: [{ id: 'r-0001', from: 0, to: 5 }] });
  const split = splitCaptionLine(JSON.stringify({ captions: [original] }), 'c-0001', 1, 'c-0002');
  const parts = JSON.parse(split).captions;
  assert.deepEqual(parts[0].runs[0], { id: 'r-0001', from: 0, to: 3, needs_review: true });
  const merged = JSON.parse(mergeCaptionLines(split, ['c-0001', 'c-0002']));
  assert.deepEqual(merged.captions[0].runs[0], parts[0].runs[0]);
});

test('結合: 色も時刻も違う隣接 run は mergeCaptionLines 後も二件のまま', () => {
  const first = row('猫', { start: 0, end: 1, runs: [{ id: 'r-0001', from: 0, to: 1,
    look: { color: '#f00' }, anchor: { start: 0, end: 1, domain: 'source' } }] });
  const second = row('犬', { id: 'c-0002', start: 1, end: 2, runs: [{ id: 'r-0002', from: 0, to: 1,
    look: { color: '#00f' }, anchor: { start: 1, end: 2, domain: 'source' } }] });
  const merged = JSON.parse(mergeCaptionLines(JSON.stringify({ captions: [first, second] }), ['c-0001', 'c-0002']));
  assert.deepEqual(merged.captions[0].runs.map(run => [run.id, run.from, run.to]),
    [['r-0001', 0, 1], ['r-0002', 1, 2]]);
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

test('写像: buildTimelineMap の実配置で s2 の 2 秒は出力 12 秒', () => {
  const map = buildTimelineMap([{ id: 'cut-1', src: 's1', in: 0, out: 10, at: 0, track: 0 },
    { id: 'cut-2', src: 's2', in: 0, out: 10, at: 10, track: 0 }]);
  assert.equal(anchorToOutput({ src: 's2', start: 2, end: 3, domain: 'source' },
    { src: 's2', start: 0, end: 10 }, map)[0].start, 12);
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
  assert.equal(before.fire, 'shown');
  assert.equal(after.start, undefined);
  assert.equal(after.fire, 'none');
  assert.equal(after.diagnostics[0].code, 'captions.run.anchor-window');
});

test('写像: 配置 in=6 のとき字幕 5 秒の開始は出力 4 秒に寄せる', () => {
  const map = { segments: [{ kind: 'src', src: 's1', in: 6, out: 10,
    speed: 1, outStart: 4, outEnd: 8, cutIndex: 0 }] };
  const result = anchorToOutput({ src: 's1', start: 4, end: 5, domain: 'source' },
    { src: 's1', start: 5, end: 8 }, map)[0];
  assert.equal(result.start, 4);
  assert.equal(result.fire, 'shown');
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

test('移行: 旧形式が無ければ元と深く等しく diff も空', () => {
  const original = { captions: [row('猫')] };
  const result = planCaptionLookMigration(original, {});
  assert.deepEqual(result.next, original);
  assert.deepEqual(result.diff, []);
  assert.equal(Object.hasOwn(result.next.captions[0], 'runs'), false);
  assert.equal(Object.hasOwn(result.next, 'emphasis_words'), false);
  assert.equal(Object.hasOwn(readCaptionLookV1(original, {}).captions[0], 'runs'), false);
  const withEmpty = { captions: [row('猫', { runs: [] })], emphasis_words: [] };
  assert.deepEqual(planCaptionLookMigration(withEmpty, {}).next, withEmpty);
});

test('移行: 縁の 6px と scale 0.7、5px と scale 1.3 を厳密に戻す', () => {
  for (const [width, scale] of [[6, 0.7], [5, 1.3]]) {
    const original = { captions: [row('猫', { runs: [{ from: 0, to: 1,
      style: { scale, stroke: { color: '#fff', width_px: width } } }] })] };
    const migrated = planCaptionLookMigration(original, {}).next;
    const restored = captionRenderInputFromV1(migrated);
    assert.equal(restored.captions[0].runs[0].style.stroke.width_px, width);
    assert.match(applyCaptionRunsToHtml('<p class="akari-caption__line">猫</p>', '猫',
      migrated.captions[0].runs), new RegExp(`-webkit-text-stroke:${width}px`));
  }
});

test('移行: 縁の 1px と scale 3 を戻し、太さと倍率の格子でも値を保つ', () => {
  const check = (width, scale) => {
    const original = { captions: [row('猫', { runs: [{ from: 0, to: 1,
      style: { scale, stroke: { color: '#fff', width_px: width } } }] })] };
    const migrated = planCaptionLookMigration(original, {}).next;
    assert.equal(captionRenderInputFromV1(migrated).captions[0].runs[0].style.stroke.width_px,
      width, `太さ ${width}、倍率 ${scale}`);
    if (width === 1 && scale === 3) {
      assert.equal(resolveCaptionRuns('猫', migrated.captions[0].runs)[0].style.stroke.width_px, 1);
      assert.match(applyCaptionRunsToHtml('<p class="akari-caption__line">猫</p>', '猫',
        migrated.captions[0].runs), /-webkit-text-stroke:1px/);
    }
  };
  check(1, 3);
  for (let widthStep = 1; widthStep <= 24; widthStep++) {
    for (let scaleStep = 5; scaleStep <= 30; scaleStep++) {
      const scale = scaleStep / 10;
      check(widthStep / 2, Math.round(scale * 10) / 10);
    }
  }
});

const emphasisForThree = () => ({ captions: [
  row('猫', { id: 'c-0001', start: 0, end: 1 }),
  row('犬犬', { id: 'c-0002', start: 1, end: 2 }),
  row('鳥', { id: 'c-0003', start: 2, end: 3 })
], emphasis_words: ['猫', '犬', '鳥'].map((word, index) => ({
  id: `e-000${index + 1}`, src: 's1', word, t_start: index, t_end: index + 1,
  emotion: 'joy'
})) });

test('移行: 最初の行を消しても後ろの強調語を落とさない', () => {
  const migrated = planCaptionLookMigration(emphasisForThree(), {}).next;
  migrated.captions.shift();
  assert.deepEqual(captionRenderInputFromV1(migrated).emphasis_words.map(item => item?.id),
    ['e-0002', 'e-0003']);
});

test('移行: 移した run を消しても残りの強調語を順に戻す', () => {
  const migrated = planCaptionLookMigration(emphasisForThree(), {}).next;
  migrated.captions[0].runs = [];
  assert.deepEqual(captionRenderInputFromV1(migrated).emphasis_words.map(item => item?.id),
    ['e-0002', 'e-0003']);
});

test('移行: 後から移せた強調語には元の配列の位置を付ける', () => {
  const first = planCaptionLookMigration(emphasisForThree(), {}).next;
  assert.deepEqual(first.emphasis_words.map(item => item.id), ['e-0002']);
  first.captions[1].text = '犬';
  assert.equal(readCaptionLookV1(first, {}).captions[1].runs[0].migrated_emphasis.index, 1);
  const second = planCaptionLookMigration(first, {}).next;
  const runs = second.captions.flatMap(item => item.runs ?? []);
  assert.deepEqual(runs.map(run => run.migrated_emphasis.index), [0, 1, 2]);
  assert.deepEqual(captionRenderInputFromV1(second).emphasis_words.map(item => item?.id),
    ['e-0001', 'e-0002', 'e-0003']);
});

test('移行: 範囲外と空の旧 run は元の形で残し意味の error を増やさない', () => {
  const invalid = [
    { from: 0, to: 2, style: { color: '#f00' } },
    { from: 0, to: 0, animation: { in: { id: 'pop' } } }
  ];
  const original = { captions: [row('猫', { runs: invalid })] };
  const result = planCaptionLookMigration(original, {});
  assert.deepEqual(result.next.captions[0].runs, invalid);
  assert.deepEqual(result.notices, ['範囲の外の古い指定 2 件はそのまま残しました']);
  assert.deepEqual(readCaptionLookV1(original, {}).captions[0].runs, invalid);
  assert.deepEqual(captionRenderInputFromV1(result.next).captions[0].runs, invalid);
  assert.equal(validateCaptionsSemantics({ captions: result.next })
    .filter(item => item.severity === 'error').length, 0);
});

test('壊れた runs: 読み取り・移行・描画入力・描画対象の四経路で形を保つ', () => {
  for (const runs of [{}, 'x', [null]]) {
    const original = { captions: [row('猫', { runs })] };
    assert.deepEqual(readCaptionLookV1(original, {}).captions[0].runs, runs);
    assert.deepEqual(planCaptionLookMigration(original, {}).next.captions[0].runs, runs);
    assert.strictEqual(captionRenderInputFromV1(original), original);
    assert.deepEqual(renderableCaptionRuns(original.captions[0], original), runs);
    const mixed = { captions: [original.captions[0], row('犬', { id: 'c-0002',
      runs: [{ id: 'r-0001', from: 0, to: 1, look: { color: '#fff' } }] })] };
    assert.deepEqual(captionRenderInputFromV1(mixed).captions[0].runs, runs);
  }
});

test('移行: emphasis の順序、追加項目、style_hint の省略を復元する', () => {
  const emphasis = [
    { id: 'e-0009', src: 's1', word: '猫', t_start: 0, t_end: 1, emotion: 'joy', note: '先頭' },
    { id: 'e-0001', src: 's1', word: '犬', t_start: 1, t_end: 2,
      emotion: 'joy', style_hint: 'color-only', note: '残す' },
    { id: 'e-0005', src: 's1', word: '鳥', t_start: 2, t_end: 3,
      emotion: 'surprise', style_hint: 'one-char-bang', extra: { k: '値' } }
  ];
  const original = { captions: [row('猫犬鳥', { start: 0, end: 3 })], emphasis_words: emphasis };
  const migrated = planCaptionLookMigration(original, {}).next;
  assert.equal(migrated.emphasis_words.length, 1);
  assert.deepEqual(captionRenderInputFromV1(migrated).emphasis_words, emphasis);
  assert.equal(Object.hasOwn(captionRenderInputFromV1(migrated).emphasis_words[0], 'style_hint'), false);
});

test('出所: 日本語と絵文字を含む正規化 SHA-256 は node:crypto と一致し鍵順に依らない', () => {
  const value = { 日本語: { z: '😀', a: ['猫', { b: 2, a: 1 }] }, x: true };
  const normalized = { x: true, 日本語: { a: ['猫', { a: 1, b: 2 }], z: '😀' } };
  const expected = createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex');
  assert.equal(captionValueHash(value), `sha256:${expected}`);
  assert.equal(captionValueHash(value), captionValueHash(normalized));
});

test('出所: textStyleToJson の保存順を通しても applied_hash は変わらない', () => {
  const catalog = { sample: { style: { shadow: { color: '#fff', blur_px: 2 },
    size_px: 80, color: '#f00' } } };
  const migrated = planCaptionLookMigration({ captions: [row('猫', { style_preset: 'sample' })] }, catalog).next;
  const before = migrated.captions[0].style_sources.look.applied_hash;
  const parsed = parseCaptions(JSON.stringify(migrated)).captions[0];
  const written = JSON.parse(insertCaptionLine(JSON.stringify({ captions: [] }),
    { ...parsed, id: 'c-0002' }));
  assert.equal(captionValueHash(written.captions[0].text_style), before);
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

test('検証: 行の時刻の外の anchor は error ではなく warning', () => {
  const diagnostics = validateCaptionsSemantics({ captions: { captions: [row('猫', {
    runs: [{ id: 'r-0001', from: 0, to: 1, fire: 'spoken',
      anchor: { src: 's1', start: 11, end: 12, domain: 'source' } }]
  })] } });
  assert.equal(diagnostics.find(item => item.code === 'captions.run.anchor-window').severity, 'warning');
  assert.equal(diagnostics.some(item => item.severity === 'error'), false);
});

test('検証: 配置がある行の窓外 anchor は写像の警告を一件だけ出す', () => {
  const fixture = { captions: [row('猫', { start: 5, end: 8, runs: [
    { id: 'r-0001', from: 0, to: 1, fire: 'spoken',
      anchor: { src: 's1', start: 4, end: 6, domain: 'source' } }
  ] })] };
  const cuts = [{ id: 'cut-1', src: 's1', in: 0, out: 10, at: 0, track: 0 }];
  const warnings = validateCaptionsSemantics({ captions: fixture, timeline: cuts })
    .filter(item => item.path === 'captions.json#captions[0].runs[0]'
      && item.code === 'captions.run.anchor-window');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, 'warning');
  assert.equal(warnings[0].message, '発火を表示窓の始まりへ寄せました。');
});

test('検証: 配置がない行の窓外 anchor は静的な警告を一件だけ出す', () => {
  const diagnostics = validateCaptionsSemantics({ captions: { captions: [row('猫', {
    start: 5, end: 8, runs: [{ id: 'r-0001', from: 0, to: 1, fire: 'spoken',
      anchor: { src: 's1', start: 4, end: 6, domain: 'source' } }]
  })] } });
  const warnings = diagnostics.filter(item => item.path === 'captions.json#captions[0].runs[0]'
    && item.code === 'captions.run.anchor-window');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, 'warning');
  assert.equal(warnings[0].message, '範囲の実測時刻を行の表示窓へ切り詰めます。');
});

test('検証: 同じ素材の複数配置でも同じ範囲の警告は一件にまとめる', () => {
  const cuts = [0, 10].map((at, index) =>
    ({ id: `cut-${index + 1}`, src: 's1', in: 0, out: 10, at, track: 0 }));
  const diagnostics = validateCaptionsSemantics({ captions: { captions: [row('猫', {
    start: 5, end: 8, runs: [{ id: 'r-0001', from: 0, to: 1, fire: 'spoken',
      anchor: { src: 's1', start: 4, end: 6, domain: 'source' } }]
  })] }, timeline: cuts });
  assert.equal(diagnostics.filter(item => item.path === 'captions.json#captions[0].runs[0]'
    && item.code === 'captions.run.anchor-window').length, 1);
});

test('検証: null ルートと null 行・run を飛ばして例外を出さない', () => {
  assert.deepEqual(validateCaptionsSemantics({ captions: null }), []);
  assert.deepEqual(validateCaptionsSemantics({ captions: { captions: null } }), []);
  assert.deepEqual(validateCaptionsSemantics({ captions: { captions: [null,
    row('猫', { runs: [null, 1] })] } }), []);
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
