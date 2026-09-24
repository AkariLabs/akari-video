import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { effectiveMyStyleLook, effectiveMyStyleMotion, myStyleSaveParts, myStyleLookPatch, myStyleApplyNotice, placedMyStyleTextStyle,
  placedMyStyleMotion, appliedMyStyleKinds, unsupportedMyStyleLookFields, replaceMyStyleLookInSource, replaceMyStylePartsInSource, appendMyStyleUsage,
  myStyleOutputHeight, newMyStyleSlug } from '../lib/browser/my-style-look.js';
import { myStyleAttachedPartsFromEdit, applyMyStyleAttachedParts, detachMovedStyleItem,
  supportedMyStyleAttachPart } from '../lib/browser/my-style-look.js';
import { resolveItemAnchors } from '../../../../../packages/edit-store/lib/index.js';
import { parseCaptions } from '../../../../../packages/edit-store/lib/caption-store.js';
import { resolveCaptionReferenceScale, scaleCaptionPx, captionTextShadowValue } from '../../../../../packages/edit-store/lib/caption-display.js';

test('実効の見た目を解決し、位置と動きを保存しない', () => {
  const look = effectiveMyStyleLook({ color: '#ffffff', stroke: { color: '#000000', widthPx: 2 },
    zone: 'bottom', position: { y: 0.8 } }, { color: '#ff1744', stroke: { widthPx: 6 },
    background: { color: '#111111', opacity: 0.7, widthPct: 40 },
    animation: { in: { id: 'pop' } }, textAnchor: 'tc', layout: { mode: 'reference-pixel' } }, 1920);
  assert.deepEqual(look, { color: '#ff1744', stroke: { color: '#000000', width_px: 6 },
    background: { color: '#111111', opacity: 0.7 },
    shadow: { color: '#000000', opacity: 0 }, glow: { color: '#000000', density: 0 },
    reference_height_px: 1920 });
  assert.deepEqual(myStyleLookPatch({ color: '#ff1744', stroke: { width_px: 6 }, zone: 'top' }),
    { color: '#ff1744', stroke: { widthPx: 6 } });
  assert.deepEqual(unsupportedMyStyleLookFields({ color: '#ff1744', italic: true,
    background: { opacity: 0.5, width_pct: 60 } }), ['italic', 'background.width_pct']);
});

test('ひも付いた効果音・装飾・画面効果を保存し、別の字幕への当て直しで重複しない', () => {
  const edit = { version: 2, output: { width: 320, height: 180, fps: 10 },
    sources: [{ id: 'main', path: 'assets/source.mp4' },
      { id: 'sound', path: 'assets/audio/pop/pop.wav' }],
    tracks: [
      { id: 'cut', lane: 'visual', items: [{ id: 'cut-1', at: 0, duration: 100,
        source: { kind: 'media', src: 'main', in: 0, out: 10 } }] },
      { id: 'sound-track', lane: 'audio', items: [{ id: 'sound-1', at: 20, duration: 5,
        role: 'sfx', source: { kind: 'media', src: 'sound', in: 0, out: .5 },
        anchor: { caption: 'c-0001', duration: 'own' } }] },
      { id: 'overlay', lane: 'visual', items: [{ id: 'decor-1', at: 20, duration: 20,
        source: { kind: 'html', path: 'assets/overlay/frame/frame.html' },
        anchor: { caption: 'c-0001', duration: 'caption' } }] },
      { id: 'effect', lane: 'visual', items: [{ id: 'fx-1', at: 20, duration: 20,
        source: { kind: 'filter', filter: { type: 'invert' } },
        anchor: { caption: 'c-0001', duration: 'caption' } }] },
      { id: 'captions', lane: 'visual', content: { from: 'captions.json' } },
    ] };
  const parts = myStyleAttachedPartsFromEdit(edit, 'c-0001');
  assert.deepEqual(parts.map(part => part.kind), ['sfx', 'decor', 'fx']);
  const captions = [{ id: 'c-0001', start: 2, end: 4 }, { id: 'c-0002', start: 5, end: 6 }];
  const applied = applyMyStyleAttachedParts(edit, captions, ['c-0002'], 'style-one', parts);
  const resolved = resolveItemAnchors(applied, captions).edit;
  const again = applyMyStyleAttachedParts(resolved, captions, ['c-0002'], 'style-one', parts);
  const placed = again.tracks.flatMap(track => track.items ?? []).filter(item => item.anchor?.attached_by?.caption === 'c-0002');
  assert.deepEqual(placed.map(item => item.source.kind).sort(), ['filter', 'html', 'media']);
  assert.deepEqual(placed.map(item => item.at), [50, 50, 50]);
  assert.equal(placed.find(item => item.source.kind === 'html').duration, 10);
  assert.equal(placed.find(item => item.source.kind === 'media').duration, 5);
  assert.equal(again.sources.filter(source => source.path === 'assets/audio/pop/pop.wav').length, 1);
});

test('手で移動した印付き要素は時刻を保ちアンカーと印を外す', () => {
  const item = { id: 'sound', at: 47, duration: 5, source: { kind: 'media', src: 'sound' },
    anchor: { caption: 'c-0001', attached_by: { style_uid: 'style-one', caption: 'c-0001' } } };
  const edit = { output: { fps: 10 }, sources: [], tracks: [{ id: 'audio', lane: 'audio', items: [item] }] };
  detachMovedStyleItem(edit, 'sound');
  assert.deepEqual({ at: item.at, duration: item.duration }, { at: 47, duration: 5 });
  assert.equal('anchor' in item, false);
  const manual = { id: 'manual', at: 47, duration: 5, source: { kind: 'media', src: 'sound' },
    anchor: { caption: 'c-0001' } };
  edit.tracks[0].items.push(manual);
  detachMovedStyleItem(edit, 'manual');
  assert.deepEqual(manual.anchor, { caption: 'c-0001' });
  const widget = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
  const drag = widget.slice(widget.indexOf('protected async commitEditV2Drag('),
    widget.indexOf('protected async ', widget.indexOf('protected async commitEditV2Drag(') + 10));
  assert.match(drag, /this\.rawV2Item\(movedId\)\?\.anchor\?\.attached_by/);
});

test('旧予約形と未来の attach 部品は適用せず保持対象として知らせる', () => {
  const old = { kind: 'sfx', mode: 'attach', asset: { category: 'audio', id: 'pop' } };
  const future = { kind: 'decor', mode: 'attach', attach: { at: 'burst', offset_frames: 0 },
    asset: { category: 'overlay', id: 'frame' }, file: 'frame.html' };
  const extended = { kind: 'decor', scope: 'caption', mode: 'attach', attach: { at: 'whole', offset_frames: 0 },
    asset: { category: 'overlay', id: 'frame' }, file: 'frame.html', timeline: 'future' };
  assert.equal(supportedMyStyleAttachPart(old), false);
  assert.equal(supportedMyStyleAttachPart(future), false);
  assert.equal(supportedMyStyleAttachPart(extended), false);
  assert.deepEqual(appliedMyStyleKinds([old, future, extended], ['sfx', 'decor']), []);
  assert.match(myStyleApplyNotice([old, future, extended]), /効果音・装飾/);
});

test('実効の動きを snake_case で保存し、無い字幕は motion を作らない', () => {
  const defaults = { animation: { in: { id: 'fade-up', durationSec: .4, ease: 'ease-out' } } };
  const cue = { animation: { loop: { id: 'float', amp: 8 } }, color: '#f00' };
  assert.deepEqual(effectiveMyStyleMotion(defaults, cue), {
    in: { id: 'fade-up', duration_sec: .4, ease: 'ease-out' }, loop: { id: 'float', amp: 8 } });
  assert.equal(effectiveMyStyleMotion(undefined, { color: '#fff' }), undefined);
  assert.equal('animation' in effectiveMyStyleLook(defaults, cue, 1080), false);
  assert.deepEqual(placedMyStyleMotion({ in: { id: 'fade-up', duration_sec: .4 } }),
    { in: { id: 'fade-up', durationSec: .4 } });
  const both = myStyleSaveParts(defaults, cue, 1080, ['look', 'motion']);
  assert.deepEqual(both.map(part => part.kind), ['look', 'motion']);
  assert.equal('animation' in both[0].text_style, false);
  assert.deepEqual(both[1].animation.loop, { id: 'float', amp: 8 });
  assert.deepEqual(myStyleSaveParts(undefined, { color: '#fff' }, 1080, ['motion']), []);
  assert.deepEqual(myStyleSaveParts(defaults, cue, 1080, ['motion']).map(part => part.kind), ['motion']);
});

test('部品の選択は 1 回の source 変換で look と motion を独立に置換する', () => {
  const source = JSON.stringify({ captions: [{ id: 'one', style_preset: 'neon', text_style: {
    color: '#fff', position: { y: .3 }, animation: {
      in: { id: 'old' }, loop: { id: 'old-loop' }, out: { id: 'old-out' } } } }] });
  const look = { kind: 'look', text_style: { color: '#f00', reference_height_px: 1080 } };
  const motion = { kind: 'motion', animation: { in: { id: 'fade-up' } } };
  const motionOnly = JSON.parse(replaceMyStylePartsInSource(source, ['one'], [motion])).captions[0];
  assert.equal(motionOnly.style_preset, 'neon');
  assert.equal(motionOnly.text_style.color, '#fff');
  assert.deepEqual(motionOnly.text_style.position, { y: .3 });
  assert.deepEqual(motionOnly.text_style.animation, { in: { id: 'fade-up' } });
  const lookOnly = JSON.parse(replaceMyStylePartsInSource(source, ['one'], [look])).captions[0];
  assert.equal('style_preset' in lookOnly, false);
  assert.deepEqual(lookOnly.text_style.animation, { in: { id: 'old' }, loop: { id: 'old-loop' }, out: { id: 'old-out' } });
  const both = replaceMyStylePartsInSource(source, ['one'], [look, motion]);
  const after = JSON.parse(both).captions[0];
  assert.equal(after.text_style.color, '#f00');
  assert.deepEqual(after.text_style.animation, { in: { id: 'fade-up' } });
  assert.equal('style_preset' in after, false);
  assert.notEqual(both, source);
  assert.equal(source, JSON.stringify({ captions: [{ id: 'one', style_preset: 'neon', text_style: {
    color: '#fff', position: { y: .3 }, animation: {
      in: { id: 'old' }, loop: { id: 'old-loop' }, out: { id: 'old-out' } } } }] }));
});

test('効果無しを保存して、当て先の既定 glow も実効値で無効化する', () => {
  const look = effectiveMyStyleLook(undefined, { color: '#ff1744' }, 1920);
  assert.deepEqual(look.stroke, { width_px: 0 });
  assert.deepEqual(look.background, { opacity: 0 });
  assert.deepEqual(look.shadow, { color: '#000000', opacity: 0 });
  assert.deepEqual(look.glow, { color: '#000000', density: 0 });
  const source = JSON.stringify({ default_text_style: { glow: { color: '#ff00ff', density: 50 } },
    captions: [{ id: 'one', start: 0, end: 1, text: '字幕', speaker: null, sourceRef: null,
      edited: false, text_style: { color: '#fff' } }] });
  const updated = replaceMyStyleLookInSource(source, ['one'], look);
  const effective = parseCaptions(updated).captions[0].textStyle;
  assert.equal(effective.glow.density, 0);
  assert.equal(effective.glow.color, '#000000');
  assert.match(captionTextShadowValue(effective.shadow && { color: effective.shadow.color,
    opacity: effective.shadow.opacity }, { color: effective.glow.color,
    density: effective.glow.density }), /rgba\(0,0,0,0\)/);
});

test('置換後の default layout と cue layout を事前に検出し、置いた文字も拒否する', () => {
  const layout = { mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
    left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1 };
  const look = { color: '#f00', reference_height_px: 1920 };
  const source = JSON.stringify({ default_text_style: { layout }, captions: [
    { id: 'one', text_style: { color: '#fff' } }, { id: 'two', text_style: { color: '#fff' } }
  ] });
  assert.throws(() => replaceMyStyleLookInSource(source, ['one', 'two'], look), /layout.*基準高さ/);
  assert.throws(() => placedMyStyleTextStyle({ position: { y: .5 } }, look,
    { layout: { mode: 'reference-pixel' } }), /layout.*基準高さ/);
});

test('未対応部品と見た目項目の名前を 1 行で知らせ、未対応が無ければ通知しない', () => {
  assert.equal(myStyleApplyNotice([{ kind: 'look', text_style: { color: '#fff', italic: true,
    background: { width_pct: 60 } } }, { kind: 'motion' }]),
  '斜体・座布団の幅 は当てません。');
  assert.equal(myStyleApplyNotice([{ kind: 'look', text_style: { color: '#fff' } }]), undefined);
  assert.equal(myStyleApplyNotice([{ kind: 'camera' }]), 'カメラ は当てません。');
  assert.deepEqual(placedMyStyleTextStyle({ position: { y: .4625 }, textAnchor: 'tc' },
    { color: '#ff1744', shadow: null }),
  { position: { y: .4625 }, textAnchor: 'tc', color: '#ff1744' });
});

test('look は余分な効果を消し、位置・動き・任意欄を保ち、プリセットも同時に外す', () => {
  const source = JSON.stringify({ captions: [{ id: 'one', style_preset: 'neon', text_style: {
    color: '#fff', glow: { color: '#f0f' }, animation: { in: { id: 'pop' } },
    position: { y: 0.3 }, zone: 'top', other: 'keep' } }] });
  const updated = replaceMyStyleLookInSource(source, ['one'], {
    color: '#f00', size_px: 80, reference_height_px: 1920, animation: { in: { id: 'bad' } },
    stroke: { color: '#fff', width_px: 4, other: 2 }
  });
  const cue = JSON.parse(updated).captions[0];
  assert.equal('style_preset' in cue, false);
  assert.deepEqual(cue.text_style, { animation: { in: { id: 'pop' } }, position: { y: 0.3 },
    zone: 'top', other: 'keep', color: '#f00', size_px: 80, reference_height_px: 1920,
    stroke: { color: '#fff', width_px: 4 } });
  assert.equal(myStyleOutputHeight('{"output":{"height":1920}}'), 1920);
  assert.equal(scaleCaptionPx(80, resolveCaptionReferenceScale(
    { reference_height_px: 1920 }, { width: 1920, height: 1080 })), 45);
  assert.deepEqual(placedMyStyleTextStyle({ position: { y: 0.4 }, glow: { color: '#fff' } },
    { color: '#f00', reference_height_px: 1920 }),
  { position: { y: 0.4 }, color: '#f00', referenceHeightPx: 1920 });
});

test('利用台帳は既存の行を保持して追記する', () => {
  const parts = [{ kind: 'look' }, { kind: 'motion' }, { kind: 'sfx' }];
  assert.deepEqual(appliedMyStyleKinds(parts, ['motion']), ['motion']);
  assert.deepEqual(appliedMyStyleKinds(parts, ['look']), ['look']);
  assert.deepEqual(appliedMyStyleKinds(parts, ['look', 'motion']), ['look', 'motion']);
  const entry = { caption_ids: ['one', 'two'], style_uid: '01K5ZXY1234ABCDEFGHJKMNPQRS',
    revision: 2, parts: appliedMyStyleKinds(parts, ['motion']), applied_at: '2026-09-24T00:00:00.000Z' };
  const first = appendMyStyleUsage(undefined, entry);
  const second = appendMyStyleUsage(first, { ...entry, caption_ids: ['three'] });
  assert.deepEqual(JSON.parse(second), { version: 1, entries: [entry, { ...entry, caption_ids: ['three'] }] });
});

test('保存 ID は名前から読める slug を作る', () => {
  assert.match(newMyStyleSlug('Vintage Blue'), /^vintage-blue-[a-f0-9]{8}$/);
  assert.match(newMyStyleSlug('強調'), /^my-style-[a-f0-9]{8}$/);
});

test('同梱プリセット解決後の値も実効の見た目に入る', () => {
  const root = { default_text_style: { color: '#ffffff' }, captions: [{ id: 'one', start: 0, end: 1,
    text: '文字', speaker: null, sourceRef: null, edited: false, style_preset: 'subtitle-variety',
    text_style: { color: '#ff1744', position: { y: 0.7 } } }] };
  const parsed = parseCaptions(JSON.stringify(root));
  const look = effectiveMyStyleLook(parsed.defaultTextStyle, parsed.captions[0].textStyle);
  assert.equal(look.color, '#ff1744');
  assert.equal(look.weight, 700);
  assert.equal('position' in look, false);
});
