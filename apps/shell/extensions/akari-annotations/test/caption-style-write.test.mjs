import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as captionStyleEffects from '../lib/browser/inspector/caption-style-effects.js';
import * as myStyleLook from '../lib/browser/my-style-look.js';
import * as libraryApplyPlan from '../lib/browser/library-apply-plan.js';
import * as editStore from '../../../../../packages/edit-store/lib/index.js';
import { parseCaptions, updateCaptionTextStyleInSource } from '../../../../../packages/edit-store/lib/caption-store.js';

const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
const start = source.indexOf("                case 'caption-style-my-style':");
const end = source.indexOf("                case 'bgm-duck-db':", start);
assert.ok(start > 0 && end > start);
const block = source.slice(start, end);
const run = new Function('request', 'location', 'caption_style_effects_1', 'my_style_look_1', 'edit_store_2', 'buffer_1', 'library_apply_plan_1', `return (async function () {
  switch (request.kind) { ${block} }
}).call(this);`);
const caption = (id, style = {}, stylePreset, rawStyle = style) => ({
  id, textStyle: style, stylePreset, rawStyle
});
const location = { captionsUri: { toString: () => 'captions' }, editUri: { toString: () => 'edit' },
  root: { toString: () => 'root' } };

function rawStyle(style) {
  return {
    ...(style.color !== undefined ? { color: style.color } : {}),
    ...(style.fontWeight !== undefined ? { font_weight: style.fontWeight } : {}),
    ...(style.weight !== undefined ? { weight: style.weight } : {}),
    ...(style.lineHeight !== undefined ? { line_height: style.lineHeight } : {}),
    ...(style.letterSpacingEm !== undefined ? { letter_spacing_em: style.letterSpacingEm } : {}),
    ...(style.fontFamily !== undefined ? { font_family: style.fontFamily } : {}),
    ...(style.shadow ? { shadow: {
      color: style.shadow.color,
      ...(style.shadow.opacity !== undefined ? { opacity: style.shadow.opacity } : {}),
      ...(style.shadow.blurPx !== undefined ? { blur_px: style.shadow.blurPx } : {}),
      ...(style.shadow.distancePx !== undefined ? { distance_px: style.shadow.distancePx } : {}),
      ...(style.shadow.angleDeg !== undefined ? { angle_deg: style.shadow.angleDeg } : {})
    } } : {}),
    ...(style.glow ? { glow: { color: style.glow.color,
      ...(style.glow.density !== undefined ? { density: style.glow.density } : {}),
      ...(style.glow.spread !== undefined ? { spread: style.glow.spread } : {}) } } : {}),
    ...(style.stroke ? { stroke: {
      ...(style.stroke.color !== undefined ? { color: style.stroke.color } : {}),
      ...(style.stroke.widthPx !== undefined ? { width_px: style.stroke.widthPx } : {})
    } } : {})
  };
}

const sourceFor = captions => JSON.stringify(captions.map(item => ({
  id: item.id, start: 0, end: 1, text: '字幕', speaker: null, sourceRef: null, edited: false,
  ...(item.stylePreset ? { style_preset: item.stylePreset } : {}),
  ...(Object.keys(rawStyle(item.rawStyle)).length ? { text_style: rawStyle(item.rawStyle) } : {})
})));

async function invoke(kind, value, captions, targets, source = sourceFor(captions),
  staleSource = source, expectOk = true, editSource, libraryApplyKind) {
  const calls = [];
  const history = [];
  const writes = [];
  let reads = 0;
  const context = {
    captions,
    lastAppliedCaptionsSource: staleSource,
    fileService: { readFile: async uri => { reads++; return { value: uri === location.editUri ? editSource : source }; },
      writeFile: async () => { throw new Error('direct FileService write is forbidden'); } },
    annotationsService: { setCaptionTextStyle: async entry => { calls.push(entry); },
      writeEditSnapshot: async entry => { writes.push(entry); } },
    pushHistory: entry => { history.push(entry); },
    reloadCaptions: async () => {}, reloadEdit: async () => {}, hideNotice: () => {}, footer: { textContent: '' }
  };
  let result;
  try { result = await run.call(context, { kind, id: captions[0].id, value,
    ...(targets ? { targets } : {}), ...(libraryApplyKind ? { libraryApplyKind } : {}) },
    location, captionStyleEffects, myStyleLook, editStore, {}, libraryApplyPlan); }
  catch (error) { result = { ok: false, message: error.message }; }
  assert.equal(result.ok, expectOk);
  assert.equal(history.length, expectOk ? 1 : 0);
  return { calls, history, reads, writes, result, footer: context.footer.textContent };
}

test('ライブラリから当てた動き・スタイルと既存マイスタイルは履歴・足元の言葉を分ける', async () => {
  for (const [applyKind, label, footer] of [
    ['textanim', '動きを当てる', '動きを当てました。'],
    ['textstyle', 'スタイルを当てる', 'スタイルを当てました。'],
    [undefined, 'マイスタイルを当てる', 'マイスタイルを当てました。'],
    ['mystyle', 'マイスタイルを当てる', 'マイスタイルを当てました。']
  ]) {
    const result = await invoke('caption-style-my-style', { parts: [{ kind: 'look', text_style: { color: '#fff' } }] },
      [caption('one')], undefined, undefined, undefined, true, undefined, applyKind);
    assert.equal(result.history[0].label, label);
    assert.equal(result.footer, footer);
    assert.equal(result.writes.length, 1);
  }
});

test('ライブラリのフォントだけ履歴・足元をフォントの言葉にし、インスペクターは従来どおり', async () => {
  const fromLibrary = await invoke('caption-style-font-family', 'Dela Gothic One', [caption('one')],
    undefined, undefined, undefined, true, undefined, 'font');
  assert.equal(fromLibrary.history[0].label, 'フォントを変える');
  assert.equal(fromLibrary.footer, 'フォントを変えました。');
  assert.equal(fromLibrary.calls.length, 1);
  const inspector = await invoke('caption-style-font-family', 'Dela Gothic One', [caption('one')]);
  assert.equal(inspector.history[0].label, '字幕のスタイルを変更');
  assert.equal(inspector.footer, '字幕のスタイルを更新しました。');
});

test('太さは font_weight と weight を同値で書き、undo で両方戻す', async () => {
  const { calls, history } = await invoke('caption-style-font-weight', 700,
    [caption('one', { fontWeight: 500, weight: 400 })]);
  assert.deepEqual(calls[0].textStyle, { fontWeight: 700, weight: 700 });
  await history[0].undo();
  assert.deepEqual(calls[1].textStyle, { fontWeight: 500, weight: 400 });
});

test('新 kind と効果は複数字幕の元の値を個別に保持し、undo は一回', async () => {
  const captions = [caption('one', { shadow: { color: '#111111' },
    stroke: { color: '#222222', widthPx: 5 } }), caption('two')];
  const targets = captions.map(item => ({ kind: 'caption', id: item.id }));
  const patch = { shadow: null, glow: { color: '#39D5FF', spread: 12 },
    stroke: { color: '#000000', widthPx: 1.5 } };
  const { calls, history } = await invoke('caption-style-effect', patch, captions, targets);
  assert.equal(calls.length, 2);
  calls.forEach(call => assert.deepEqual(call.textStyle, patch));
  await history[0].undo();
  assert.deepEqual(calls.slice(2).map(call => call.textStyle), [
    { shadow: { color: '#111111' }, glow: null,
      stroke: { color: '#222222', widthPx: 5 } },
    { shadow: null, glow: null, stroke: { color: null, widthPx: null } }
  ]);
  await history[0].redo();
  assert.equal(calls.length, 6);
  for (const [kind, value, style] of [
    ['caption-style-line-height', 1.5, { lineHeight: 1.5 }],
    ['caption-style-letter-spacing', 0.05, { letterSpacingEm: 0.05 }],
    ['caption-style-font-family', 'Dela Gothic One', { fontFamily: 'Dela Gothic One' }],
    ['caption-style-bg-padding', 12, { background: { paddingPx: 12 } }],
    ['caption-style-shadow', { color: '#000000' }, { shadow: { color: '#000000' } }],
    ['caption-style-glow', { color: '#FFFFFF' }, { glow: { color: '#FFFFFF' } }]
  ]) {
    const result = await invoke(kind, value, captions, targets);
    assert.deepEqual(result.calls.map(call => call.textStyle), [style, style]);
  }
});

test('マイスタイルは 3 字幕の見た目とプリセットを 1 書き込みで替え、undo 1 回で戻す', async () => {
  const captions = [caption('one', { color: '#111111' }), caption('two', { color: '#222222' }),
    caption('three', { color: '#333333' })];
  const source = JSON.stringify(captions.map((item, index) => ({ id: item.id, start: index, end: index + 1,
    text: '字幕', speaker: null, sourceRef: null, edited: false,
    style_preset: 'neon', text_style: { color: item.textStyle.color, glow: { color: '#fff' },
      animation: { in: { id: 'pop' } }, position: { x: index / 3, y: 0.5 }, zone: 'bottom' } })));
  const targets = captions.map(item => ({ kind: 'caption', id: item.id }));
  const result = await invoke('caption-style-my-style', { parts: [{ kind: 'look', text_style: {
    color: '#ff1744', reference_height_px: 1920, stroke: { color: '#ffffff', width_px: 6 },
    background: { color: '#111111', opacity: 0.7 }, position: { x: 0.9 }, zone: 'top'
  } }, { kind: 'motion', animation: { in: { id: 'fade-up' } } }] }, captions, targets, source);
  assert.equal(result.history.length, 1);
  assert.equal(result.writes.length, 1);
  assert.deepEqual(Object.keys(result.writes[0]).sort(),
    ['captionsSource', 'captionsUri', 'editUri', 'projectRootUri']);
  const rows = JSON.parse(result.writes[0].captionsSource);
  assert.deepEqual(rows.map(row => row.text_style.position.x), [0, 1 / 3, 2 / 3]);
  assert.deepEqual(rows.map(row => row.text_style.color), ['#ff1744', '#ff1744', '#ff1744']);
  assert.ok(rows.every(row => !('glow' in row.text_style) && !('style_preset' in row)
    && row.text_style.animation.in.id === 'fade-up' && row.text_style.reference_height_px === 1920));
  await result.history[0].undo();
  assert.equal(result.writes[1].captionsSource, source);
  await result.history[0].redo();
  assert.equal(result.writes[2].captionsSource, result.writes[0].captionsSource);
});

test('効果音部品は captions と edit を 1 書き込み・undo 1 回で復元する', async () => {
  const captions = [caption('c-0001')];
  const source = JSON.stringify([{ id: 'c-0001', start: 2, end: 3, text: '字幕', speaker: null,
    sourceRef: null, edited: false }]);
  const edit = JSON.stringify({ version: 2, output: { width: 320, height: 180, fps: 10 },
    sources: [{ id: 'main', path: 'assets/source.mp4' }],
    tracks: [{ id: 'main', lane: 'visual', items: [{ id: 'cut', at: 0, duration: 100,
      source: { kind: 'media', src: 'main', in: 0, out: 10 } }] }] });
  const value = { style_uid: 'style-one', parts: [{ kind: 'sfx', scope: 'caption', mode: 'attach',
    attach: { at: 'in', offset_frames: 0 }, asset: { category: 'audio', id: 'pop' },
    file: 'pop.wav', duration_sec: .3 }] };
  const result = await invoke('caption-style-my-style', value, captions, undefined, source, source, true, edit);
  assert.equal(result.writes.length, 1);
  assert.equal(result.history.length, 1);
  assert.ok(result.writes[0].captionsSource);
  const added = JSON.parse(result.writes[0].editSource).tracks.flatMap(track => track.items)
    .find(item => item.anchor?.attached_by?.style_uid === 'style-one');
  assert.equal(added.at, 20);
  assert.equal(added.duration, 3);
  await result.history[0].undo();
  assert.equal(result.writes[1].editSource, edit);
  assert.equal(result.writes[1].captionsSource, source);
});

test('既定 layout と基準高さが衝突する複数選択は RPC 前に全件拒否する', async () => {
  const captions = [caption('one'), caption('two')];
  const source = JSON.stringify({ default_text_style: { layout: { mode: 'reference-pixel',
    reference_width_px: 1920, reference_height_px: 1080, left_px: 261, width_px: 1120,
    bottom_px: 29, text_align: 'center', max_lines: 1 } },
  captions: captions.map((item, index) => ({ id: item.id, start: index, end: index + 1,
    text: '字幕', speaker: null, sourceRef: null, edited: false, text_style: { color: '#fff' } })) });
  const targets = captions.map(item => ({ kind: 'caption', id: item.id }));
  const result = await invoke('caption-style-my-style', { parts: [{ kind: 'look', text_style: { color: '#f00', reference_height_px: 1920 } }] },
    captions, targets, source, source, false);
  assert.match(result.result.message, /layout.*基準高さ/);
  assert.equal(result.writes.length, 0);
});

test('プリセット付き字幕の太さは合成後も選択値になり、undo は cue 側指定だけ戻す', async () => {
  const input = sourceFor([caption('one', {}, 'subtitle-variety', {})]);
  const effective = parseCaptions(input).captions[0];
  assert.equal(effective.textStyle.weight, 700);
  const { calls, history } = await invoke('caption-style-font-weight', 400,
    [caption('one', effective.textStyle, 'subtitle-variety', {})], undefined, input);
  assert.deepEqual(calls[0].textStyle, { fontWeight: 400, weight: 400 });
  const written = updateCaptionTextStyleInSource(input, 'one', calls[0].textStyle);
  assert.equal(parseCaptions(written).captions[0].textStyle.weight, 400);
  await history[0].undo();
  assert.deepEqual(calls[1].textStyle, { fontWeight: null, weight: null });
  const restored = updateCaptionTextStyleInSource(written, 'one', calls[1].textStyle);
  assert.equal(parseCaptions(restored).captions[0].textStyle.weight, 700);
  assert.equal(Object.hasOwn(JSON.parse(restored)[0], 'text_style'), false);
});

test('プリセット影の「なし」は透明化し、undo で cue 側から消して影を戻す', async () => {
  const input = sourceFor([caption('one', {}, 'subtitle-variety', {})]);
  const effective = parseCaptions(input).captions[0];
  const none = captionStyleEffects.captionEffectPatch('none', '#FFFFFF');
  const { calls, history } = await invoke('caption-style-effect', none,
    [caption('one', effective.textStyle, 'subtitle-variety', {})], undefined, input);
  assert.deepEqual(calls[0].textStyle.shadow, { color: '#000000', opacity: 0 });
  const written = updateCaptionTextStyleInSource(input, 'one', calls[0].textStyle);
  assert.equal(captionStyleEffects.captionEffectFromStyle(parseCaptions(written).captions[0].textStyle), 'none');
  await history[0].undo();
  assert.deepEqual(calls[1].textStyle, { shadow: null, glow: null,
    stroke: { color: null, widthPx: null } });
  const restored = updateCaptionTextStyleInSource(written, 'one', calls[1].textStyle);
  assert.equal(captionStyleEffects.captionEffectFromStyle(parseCaptions(restored).captions[0].textStyle),
    'shadow');
  assert.equal(Object.hasOwn(JSON.parse(restored)[0], 'text_style'), false);
});

test('プリセット影→なし→undo と混在複数選択は字幕ごとのパッチを使う', async () => {
  const presets = [caption('preset', {}, 'subtitle-variety', {}),
    caption('plain', { shadow: { color: '#222222', opacity: 0.5 } })];
  const input = sourceFor(presets);
  const parsed = parseCaptions(input).captions;
  const snapshots = parsed.map((item, index) => caption(item.id, item.textStyle,
    presets[index].stylePreset, presets[index].rawStyle));
  const targets = snapshots.map(item => ({ kind: 'caption', id: item.id }));
  const shadow = captionStyleEffects.captionEffectPatch('shadow', '#FFFFFF');
  const first = await invoke('caption-style-effect', shadow, snapshots, targets, input);
  const shadowSource = first.calls.reduce((source, call) =>
    updateCaptionTextStyleInSource(source, call.captionId, call.textStyle), input);
  const afterShadow = parseCaptions(shadowSource).captions.map(item =>
    caption(item.id, item.textStyle, item.stylePreset, {}));
  const none = captionStyleEffects.captionEffectPatch('none', '#FFFFFF');
  const second = await invoke('caption-style-effect', none, afterShadow, targets, shadowSource);
  assert.deepEqual(second.calls.map(call => call.textStyle.shadow),
    [{ color: '#000000', opacity: 0 }, null]);
  let noneSource = second.calls.reduce((source, call) =>
    updateCaptionTextStyleInSource(source, call.captionId, call.textStyle), shadowSource);
  assert.ok(parseCaptions(noneSource).captions.every(item =>
    captionStyleEffects.captionEffectFromStyle(item.textStyle) === 'none'));
  await second.history[0].undo();
  noneSource = second.calls.slice(2).reduce((source, call) =>
    updateCaptionTextStyleInSource(source, call.captionId, call.textStyle), noneSource);
  assert.ok(parseCaptions(noneSource).captions.every(item =>
    captionStyleEffects.captionEffectFromStyle(item.textStyle) === 'shadow'));
});

test('プリセット由来の影は効果の色と強さで上書きできる', async () => {
  const input = sourceFor([caption('one', {}, 'subtitle-variety', {})]);
  const effective = parseCaptions(input).captions[0].textStyle;
  const color = captionStyleEffects.captionEffectColorPatch(effective, '#ABCDEF');
  const recolored = await invoke('caption-style-effect', color,
    [caption('one', effective, 'subtitle-variety', {})], undefined, input);
  const colorSource = updateCaptionTextStyleInSource(input, 'one', recolored.calls[0].textStyle);
  assert.equal(parseCaptions(colorSource).captions[0].textStyle.shadow.color, '#ABCDEF');
  const strength = captionStyleEffects.captionEffectStrengthPatch(effective, 2);
  const intensified = await invoke('caption-style-effect', strength,
    [caption('one', effective, 'subtitle-variety', {})], undefined, input);
  const strengthSource = updateCaptionTextStyleInSource(input, 'one', intensified.calls[0].textStyle);
  assert.equal(parseCaptions(strengthSource).captions[0].textStyle.shadow.distancePx, 17);
  assert.equal(parseCaptions(strengthSource).captions[0].textStyle.shadow.blurPx, 4);
});

test('ネオンプリセットの影と glow を「なし」で消し、色・強さも個別指定できる', async () => {
  const input = sourceFor([caption('one', {}, 'neon', {})]);
  const effective = parseCaptions(input).captions[0].textStyle;
  assert.equal(captionStyleEffects.captionEffectFromStyle(effective), 'neon');
  const none = await invoke('caption-style-effect', captionStyleEffects.captionEffectPatch('none', '#FFFFFF'),
    [caption('one', effective, 'neon', {})], undefined, input);
  assert.deepEqual(none.calls[0].textStyle.shadow, { color: '#000000', opacity: 0 });
  assert.deepEqual(none.calls[0].textStyle.glow, { color: '#000000', density: 0 });
  const noneSource = updateCaptionTextStyleInSource(input, 'one', none.calls[0].textStyle);
  assert.equal(captionStyleEffects.captionEffectFromStyle(parseCaptions(noneSource).captions[0].textStyle), 'none');
  const recolor = captionStyleEffects.captionEffectColorPatch(effective, '#ABCDEF');
  const colorSource = updateCaptionTextStyleInSource(input, 'one', recolor);
  assert.equal(parseCaptions(colorSource).captions[0].textStyle.glow.color, '#ABCDEF');
  const strength = captionStyleEffects.captionEffectStrengthPatch(effective, 2);
  const strengthSource = updateCaptionTextStyleInSource(input, 'one', strength);
  assert.equal(parseCaptions(strengthSource).captions[0].textStyle.glow.spread, 24);
});

test('書き込み直前の字幕ファイルを一度読み、古いタイムライン値を undo に使わない', async () => {
  const current = sourceFor([
    caption('preset', {}, 'subtitle-variety', { shadow: { color: '#222222', opacity: 0.5 } }),
    caption('plain', {}, undefined, { shadow: { color: '#333333' } })
  ]);
  const stale = sourceFor([
    caption('preset', {}, undefined, { shadow: { color: '#111111' } }),
    caption('plain', {}, undefined, { shadow: { color: '#444444' } })
  ]);
  const snapshots = [caption('preset'), caption('plain')];
  const targets = snapshots.map(item => ({ kind: 'caption', id: item.id }));
  const { calls, history, reads } = await invoke('caption-style-effect',
    captionStyleEffects.captionEffectPatch('none', '#FFFFFF'), snapshots, targets, current, stale);
  assert.equal(reads, 1);
  assert.deepEqual(calls.map(call => call.textStyle.shadow),
    [{ color: '#000000', opacity: 0 }, null]);
  await history[0].undo();
  assert.deepEqual(calls.slice(2).map(call => call.textStyle.shadow), [
    { color: '#222222', opacity: 0.5 }, { color: '#333333' }
  ]);
});
