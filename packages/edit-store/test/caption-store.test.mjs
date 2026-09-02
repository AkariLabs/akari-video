import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  insertCaptionLine,
  mergeCaptionTextStyles,
  parseCaptions,
  setCaptionTimingLine,
  updateCaptionFieldsInSource,
  updateCaptionTextStyleInSource,
} from '../lib/caption-store.js';

const testRoot = dirname(fileURLToPath(import.meta.url));
// caption-display.test.mjs が使う「共有パリティ fixture」を再利用する。ここに載っている
// valid/invalid の全ケースは、既に caption-display.ts の厳格な validateCaptionTextStyle と
// render-cut の normalizeTextStyle が受理条件を 1:1 で揃えている契約上の正典行列であり、
// caption-store（この allowlist 修正の対象）が同じ行列に対して「行を破棄しない」ことを
// 確認するのに最適な素材のため、fixture を新設せず既存のものへ乗せる。
const styleParity = JSON.parse(await readFile(join(testRoot, 'fixtures/caption-style-validation-parity.json'), 'utf8'));

const caption = (id, start, text, extra = {}) => ({
  id,
  start,
  end: start + 1,
  text,
  speaker: null,
  sourceRef: { segment: 0 },
  edited: false,
  ...extra
});

test('text 更新は対象 1 物理行だけを書き換え words を再導出する', () => {
  const rows = [
    caption('c-0001', 0, 'alpha beta gamma', {
      end: 3,
      words: [
        { start: 0.1, end: 0.7, text: 'alpha' },
        { start: 0.8, end: 1.6, text: 'beta' },
        { start: 1.7, end: 2.9, text: 'gamma' },
      ],
      display_text: 'old',
      display_fragments: ['o', 'ld'],
      style: 'karaoke',
    }),
    caption('c-0002', 3, 'unchanged'),
  ];
  const source = `[\n  ${JSON.stringify(rows[0])},\n  ${JSON.stringify(rows[1])}\n]\n`;
  const updated = updateCaptionFieldsInSource(source, 'c-0001', { text: 'alpha delta gamma' });
  const beforeLines = source.split('\n');
  const afterLines = updated.split('\n');
  const record = JSON.parse(afterLines[1].trim().replace(/,$/, ''));

  assert.equal(afterLines.length, beforeLines.length);
  assert.equal(afterLines[2], beforeLines[2]);
  assert.deepEqual(record.words[0], rows[0].words[0]);
  assert.deepEqual(record.words[2], rows[0].words[2]);
  assert.equal(record.words[1].text, 'delta');
  assert.equal(record.edited, true);
  assert.equal(Object.hasOwn(record, 'display_text'), false);
  assert.equal(Object.hasOwn(record, 'display_fragments'), false);
  assert.equal(record.style, 'karaoke');
  assert.doesNotThrow(() => parseCaptions(updated));
});

test('speaker だけの更新は words をバイト単位で変えない', () => {
  const row = caption('c-0001', 0, 'alpha beta', {
    end: 2,
    words: [{ start: 0, end: 1, text: 'alpha' }, { start: 1, end: 2, text: 'beta' }],
  });
  const source = `[\n  ${JSON.stringify(row)}\n]\n`;
  const updated = updateCaptionFieldsInSource(source, 'c-0001', { speaker: 'speaker-2' });
  assert.deepEqual(JSON.parse(updated)[0].words, row.words);
});

test('words 無し行の text 更新では words を追加しない', () => {
  const source = `[\n  ${JSON.stringify(caption('c-0001', 0, 'before'))}\n]\n`;
  const updated = updateCaptionFieldsInSource(source, 'c-0001', { text: 'after' });
  assert.equal(Object.hasOwn(JSON.parse(updated)[0], 'words'), false);
});

test('unrecognized 配列を start 順へ並べ替えて小数を保つ', () => {
  const source = JSON.stringify([caption('c-0001', 0, '本文', {
    unrecognized: [{ start: 0.1, end: 0.2 }]
  })]);
  const updated = updateCaptionFieldsInSource(source, 'c-0001', {
    unrecognized: [{ start: 0.4567, end: 0.5678 }, { start: 0.1234, end: 0.2345 }]
  });
  assert.deepEqual(JSON.parse(updated)[0].unrecognized, [
    { start: 0.1234, end: 0.2345 }, { start: 0.4567, end: 0.5678 }
  ]);
});

test('unrecognized null はキーを削除する', () => {
  const source = JSON.stringify([caption('c-0001', 0, '本文', {
    unrecognized: [{ start: 0.1, end: 0.2 }]
  })]);
  const updated = updateCaptionFieldsInSource(source, 'c-0001', { unrecognized: null });
  assert.equal(Object.hasOwn(JSON.parse(updated)[0], 'unrecognized'), false);
});

test('unrecognized 空配列はキーを削除する', () => {
  const source = JSON.stringify([caption('c-0001', 0, '本文', {
    unrecognized: [{ start: 0.1, end: 0.2 }]
  })]);
  const updated = updateCaptionFieldsInSource(source, 'c-0001', { unrecognized: [] });
  assert.equal(Object.hasOwn(JSON.parse(updated)[0], 'unrecognized'), false);
});

test('text と unrecognized の同時更新は語再導出後に対象 span を置換する', () => {
  const originalWords = [
    { start: 0, end: 0.8, text: 'alpha' },
    { start: 1.2, end: 2, text: 'beta' }
  ];
  const source = JSON.stringify([caption('c-0001', 0, 'alpha beta', {
    end: 2, words: originalWords,
    unrecognized: [{ start: 0.8, end: 1 }, { start: 1, end: 1.2 }]
  })]);
  const updated = updateCaptionFieldsInSource(source, 'c-0001', {
    text: 'alpha new beta', unrecognized: [{ start: 1, end: 1.2 }]
  });
  const record = JSON.parse(updated)[0];
  assert.deepEqual(record.unrecognized, [{ start: 1, end: 1.2 }]);
  assert.deepEqual(record.words[0], originalWords[0]);
  assert.deepEqual(record.words[2], originalWords[1]);
  assert.ok(record.words[1].start >= 0.8 && record.words[1].end <= 1.2);
});

test('unrecognized の非 object 要素は拒否する', () => {
  const source = JSON.stringify([caption('c-0001', 0, '本文')]);
  assert.throws(() => updateCaptionFieldsInSource(source, 'c-0001', {
    unrecognized: [null]
  }), /未認識区間が不正/);
});

test('unrecognized の非有限時刻は拒否する', () => {
  const source = JSON.stringify([caption('c-0001', 0, '本文')]);
  assert.throws(() => updateCaptionFieldsInSource(source, 'c-0001', {
    unrecognized: [{ start: Number.NaN, end: 0.5 }]
  }), /未認識区間が不正/);
});

test('unrecognized の end <= start は拒否する', () => {
  const source = JSON.stringify([caption('c-0001', 0, '本文')]);
  assert.throws(() => updateCaptionFieldsInSource(source, 'c-0001', {
    unrecognized: [{ start: 0.5, end: 0.5 }]
  }), /未認識区間が不正/);
});

test('time_domain を読み、絶対時刻更新で output 変換と未宣言への undo を往復できる', () => {
  const source = JSON.stringify([caption('c-0001', 0.5, '跨ぐ字幕')], null, 2);
  const converted = setCaptionTimingLine(source, 'c-0001', 0.5, 3.5, 'output', true);
  assert.deepEqual(parseCaptions(converted).captions[0], {
    ...caption('c-0001', 0.5, '跨ぐ字幕'),
    end: 3.5,
    edited: true,
    timeDomain: 'output',
  });
  const restored = setCaptionTimingLine(converted, 'c-0001', 0.5, 1.5, null, false);
  assert.deepEqual(JSON.parse(restored), JSON.parse(source));
});

test('拡張フィールド（font_family 等）を含む text_style があっても字幕行を破棄しない', () => {
  const source = JSON.stringify([
    caption('c-0001', 0, '拡張フィールド入り', {
      text_style: {
        color: '#FFFFFF',
        size_px: 60,
        stroke: { color: '#000000', width_px: 3 },
        background: { color: '#000000', opacity: 0.5 },
        zone: 'bottom',
        font_family: 'Dela Gothic One',
        weight: 700,
        italic: true,
        underline: true,
        letter_spacing_em: 0.02,
        line_height: 1.3,
        text_transform: 'uppercase',
        shadow: { color: '#FF0000', blur_px: 4, distance_px: 6, angle_deg: 90 },
        glow: { color: '#00FF00', density: 40, spread: 20 },
        animation: { in: { id: 'zoom-pop', duration_sec: 0.24 }, out: { id: 'fade-in-out' } }
      }
    })
  ]);
  const parsed = parseCaptions(source);

  assert.equal(parsed.captions.length, 1, '拡張フィールドがあっても字幕行は 1 件残る');
  assert.deepEqual(parsed.warnings, [], '既知の拡張フィールドだけなら警告も出ない');
  const style = parsed.captions[0].textStyle;
  assert.equal(style.color, '#FFFFFF');
  assert.equal(style.sizePx, 60);
  assert.deepEqual(style.stroke, { color: '#000000', widthPx: 3 });
  assert.deepEqual(style.background, { color: '#000000', opacity: 0.5 });
  assert.equal(style.zone, 'bottom');
  assert.equal(style.fontFamily, 'Dela Gothic One');
  assert.equal(style.weight, 700);
  assert.equal(style.italic, true);
  assert.equal(style.underline, true);
  assert.equal(style.letterSpacingEm, 0.02);
  assert.equal(style.lineHeight, 1.3);
  assert.equal(style.textTransform, 'uppercase');
  assert.deepEqual(style.shadow, { color: '#FF0000', blurPx: 4, distancePx: 6, angleDeg: 90 });
  assert.deepEqual(style.glow, { color: '#00FF00', density: 40, spread: 20 });
  assert.deepEqual(style.animation, {
    in: { id: 'zoom-pop', durationSec: 0.24 },
    out: { id: 'fade-in-out' }
  });
});

test('未知キーは字幕行を破棄せず、警告を残して無視する', () => {
  const source = JSON.stringify([
    caption('c-0001', 0, '未知キー入り', {
      text_style: { color: '#FFFFFF', mystery_field: 'nope', also_unknown: 1 }
    })
  ]);
  const parsed = parseCaptions(source);

  assert.equal(parsed.captions.length, 1);
  assert.equal(parsed.captions[0].textStyle.color, '#FFFFFF');
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /1 番目の字幕の text_style に未知のフィールド/);
  assert.match(parsed.warnings[0], /mystery_field/);
  assert.match(parsed.warnings[0], /also_unknown/);
});

test('default_text_style の未知キーも既定スタイルを破棄せず警告のみ残す', () => {
  const source = JSON.stringify({
    default_text_style: { color: '#112233', bogus: true },
    captions: [caption('c-0001', 0, '本文')]
  });
  const parsed = parseCaptions(source);

  assert.deepEqual(parsed.defaultTextStyle, { color: '#112233' });
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /字幕の既定スタイルに未知のフィールド（bogus）/);
});

test('shared parity fixture の valid_style_cases 全件で字幕行が生き残る', () => {
  for (const item of styleParity.valid_style_cases) {
    const source = JSON.stringify([{ ...styleParity.caption, text_style: item.style }]);
    const parsed = parseCaptions(source);
    assert.equal(parsed.captions.length, 1, `${item.id}: valid style で字幕行が消えてはいけない`);
    assert.deepEqual(
      parsed.warnings, [],
      `${item.id}: captions.schema 準拠のフィールドだけなら警告も出ないはず`
    );
  }
});

test('shared parity fixture の invalid_cases 全件で「構造的に不正」以外は字幕行が生き残る', () => {
  // caption-display.ts の厳格な検証（フィールド単位で例外を投げ、resolveCaptionDisplay 全体を
  // 失敗させる）と違い、caption-store は「1 フィールドの欠陥で行ごと道連れにしない」設計。
  // 例外は text_style / default_text_style そのものが object ですらない、真に不正な形のときだけ。
  const structurallyInvalidDefault = new Set(['default-not-object']);
  const structurallyInvalidCaption = new Set(['caption-not-object']);
  for (const item of styleParity.invalid_cases) {
    if (structurallyInvalidDefault.has(item.id)) {
      const source = JSON.stringify({
        default_text_style: item.default_text_style,
        captions: [styleParity.caption]
      });
      assert.throws(() => parseCaptions(source), /字幕の既定スタイルを確認できません/, item.id);
      continue;
    }
    if (structurallyInvalidCaption.has(item.id)) {
      const source = JSON.stringify([{ ...styleParity.caption, text_style: item.caption_text_style }]);
      const parsed = parseCaptions(source);
      assert.equal(parsed.captions.length, 0, `${item.id}: text_style が object ですらないなら破棄してよい`);
      continue;
    }
    const root = {
      default_text_style: Object.hasOwn(item, 'default_text_style') ? item.default_text_style : undefined,
      captions: [{
        ...styleParity.caption,
        text_style: Object.hasOwn(item, 'caption_text_style') ? item.caption_text_style : { color: '#FFFFFF' }
      }]
    };
    const source = JSON.stringify(root);
    assert.doesNotThrow(() => parseCaptions(source), item.id);
    const parsed = parseCaptions(source);
    assert.equal(parsed.captions.length, 1, `${item.id}: フィールド単位の不正で字幕行を破棄してはいけない`);
  }
});

test('非退行: 不正な hex color は既存どおり値として採用しない（行は残す）', () => {
  const source = JSON.stringify([
    caption('c-0001', 0, '不正hex', { text_style: { color: 'not-a-color', size_px: 40 } })
  ]);
  const parsed = parseCaptions(source);

  assert.equal(parsed.captions.length, 1, '不正な値があっても行自体は残る（今回の設計判断）');
  assert.equal('color' in parsed.captions[0].textStyle, false, '不正な color は取り込まれない');
  assert.equal(parsed.captions[0].textStyle.sizePx, 40, '他の妥当なフィールドは影響を受けない');
});

test('非退行: 時刻や必須フィールドが真に不正な字幕は従来どおり破棄する', () => {
  const source = JSON.stringify([
    { id: 'c-0001', start: 2, end: 1, text: '開始>終了', speaker: null, sourceRef: null, edited: false },
    { id: 'c-0002', start: 0, end: 1, text: '内容OK', speaker: null, sourceRef: { segment: -1 }, edited: false },
    caption('c-0003', 3, '正常')
  ]);
  const parsed = parseCaptions(source);

  assert.deepEqual(parsed.captions.map(item => item.id), ['c-0003']);
  assert.equal(parsed.warnings.length, 2);
  assert.match(parsed.warnings[0], /1 番目の字幕は時刻または内容が不正/);
  assert.match(parsed.warnings[1], /2 番目の字幕は時刻または内容が不正/);
});

test('zone と layout が両方有効なときは zone を優先し layout を落とす（schema の併用禁止への互換動作）', () => {
  const layout = {
    mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
    left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1
  };
  const source = JSON.stringify([
    caption('c-0001', 0, 'zone-and-layout', { text_style: { zone: 'top', layout } })
  ]);
  const parsed = parseCaptions(source);

  assert.equal(parsed.captions[0].textStyle.zone, 'top');
  assert.equal('layout' in parsed.captions[0].textStyle, false);
});

test('layout 単独指定は camelCase へ丸めてそのまま取り込む', () => {
  const layout = {
    mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
    left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1
  };
  const source = JSON.stringify([caption('c-0001', 0, 'layout-only', { text_style: { layout } })]);
  const parsed = parseCaptions(source);

  assert.deepEqual(parsed.captions[0].textStyle.layout, {
    mode: 'reference-pixel',
    referenceWidthPx: 1920,
    referenceHeightPx: 1080,
    leftPx: 261,
    widthPx: 1120,
    bottomPx: 29,
    textAlign: 'center',
    maxLines: 1
  });
});

test('weight と font_weight は互いを上書きせず両方保持する（consumer 側の優先順位に委ねる）', () => {
  const source = JSON.stringify([
    caption('c-0001', 0, '両名', { text_style: { weight: 300, font_weight: 800 } })
  ]);
  const parsed = parseCaptions(source);
  assert.equal(parsed.captions[0].textStyle.weight, 300);
  assert.equal(parsed.captions[0].textStyle.fontWeight, 800);
});

test('ラウンドトリップ: 1 フィールド変更で保存しても拡張フィールドが剥がれ落ちない', () => {
  const source = JSON.stringify([
    caption('c-0001', 0, 'ラウンドトリップ', {
      text_style: {
        color: '#FFFFFF',
        font_family: 'Dela Gothic One',
        shadow: { color: '#000000', blur_px: 4 },
        animation: { in: { id: 'zoom-pop' } }
      }
    }),
    caption('c-0002', 2, '対象外')
  ], null, 2) + '\n';

  const updated = updateCaptionTextStyleInSource(source, 'c-0001', { sizePx: 72 });
  const reparsed = parseCaptions(updated);

  assert.equal(reparsed.captions.length, 2, '書き戻し後も行は消えない');
  const style = reparsed.captions[0].textStyle;
  assert.equal(style.sizePx, 72, '変更したフィールドは反映される');
  assert.equal(style.color, '#FFFFFF', '既存の基本フィールドは維持される');
  assert.equal(style.fontFamily, 'Dela Gothic One', '拡張フィールド font_family は剥がれ落ちない');
  assert.deepEqual(style.shadow, { color: '#000000', blurPx: 4 }, '拡張フィールド shadow は剥がれ落ちない');
  assert.deepEqual(style.animation, { in: { id: 'zoom-pop' } }, '拡張フィールド animation は剥がれ落ちない');
  // 外科編集そのものが影響していないことをソース文字列レベルでも確認する
  assert.match(updated, /"font_family":\s*"Dela Gothic One"/);
  assert.match(updated, /"blur_px":\s*4/);
});

test('mergeCaptionTextStyles は拡張フィールドもネストごとにキー単位で合成する', () => {
  const merged = mergeCaptionTextStyles(
    {
      shadow: { color: '#000000', opacity: 0.5 },
      glow: { color: '#FFFFFF', density: 10 },
      position: { x: 0.2 },
      animation: { in: { id: 'pop' }, loop: { id: 'float' } },
      layout: undefined
    },
    {
      shadow: { blurPx: 6 },
      glow: { spread: 40 },
      position: { y: 0.8 },
      animation: { in: { id: 'zoom-pop', durationSec: 0.3 } }
    }
  );

  assert.deepEqual(merged.shadow, { color: '#000000', opacity: 0.5, blurPx: 6 });
  assert.deepEqual(merged.glow, { color: '#FFFFFF', density: 10, spread: 40 });
  assert.deepEqual(merged.position, { x: 0.2, y: 0.8 });
  assert.deepEqual(merged.animation, { in: { id: 'zoom-pop', durationSec: 0.3 }, loop: { id: 'float' } });
});

test('新規挿入した字幕行も拡張フィールドを含めてラウンドトリップする（insertCaptionLine）', () => {
  const inserted = insertCaptionLine('[]', {
    id: 'c-0001',
    start: 0,
    end: 1,
    text: '新規',
    speaker: null,
    sourceRef: null,
    edited: false,
    textStyle: {
      color: '#ABCDEF',
      fontFamily: 'Klee One',
      stroke: { method: 'webkit-outline', color: '#000000', widthPx: 4 },
      layout: {
        mode: 'reference-pixel',
        referenceWidthPx: 1920,
        referenceHeightPx: 1080,
        leftPx: 261,
        widthPx: 1120,
        bottomPx: 29,
        textAlign: 'center',
        maxLines: 1
      }
    }
  });

  const parsed = parseCaptions(inserted);
  assert.equal(parsed.captions.length, 1);
  const style = parsed.captions[0].textStyle;
  assert.equal(style.color, '#ABCDEF');
  assert.equal(style.fontFamily, 'Klee One');
  assert.deepEqual(style.stroke, { method: 'webkit-outline', color: '#000000', widthPx: 4 });
  assert.deepEqual(style.layout, {
    mode: 'reference-pixel',
    referenceWidthPx: 1920,
    referenceHeightPx: 1080,
    leftPx: 261,
    widthPx: 1120,
    bottomPx: 29,
    textAlign: 'center',
    maxLines: 1
  });
});

test('insertCaptionLine は edited 直後へ unrecognized を直列化して round-trip する', () => {
  const spans = [{ start: 0.2, end: 0.4 }];
  const inserted = insertCaptionLine('[]', {
    id: 'c-0099', start: 0, end: 1, text: '新規', speaker: null,
    sourceRef: null, edited: false, unrecognized: spans, timeDomain: 'output'
  });
  assert.match(inserted, /"edited": false, "time_domain": "output", "unrecognized": \[\{"start":0\.2,"end":0\.4\}\]/u);
  assert.deepEqual(parseCaptions(inserted).captions[0].unrecognized, spans);
});

test('insertCaptionLine は空または不正な unrecognized をキーごと書かない', () => {
  const inserted = insertCaptionLine('[]', {
    id: 'c-0100', start: 0, end: 1, text: '新規', speaker: null,
    sourceRef: null, edited: false, unrecognized: [{ start: 0.5, end: 0.5 }]
  });
  assert.equal(inserted.includes('"unrecognized"'), false);
  assert.equal(parseCaptions(inserted).captions.length, 1);
});

// issue #40 §2（2026-09-01）: zone 方式の基準出力高さ reference_height_px は保存・読み戻しで落ちない。
test('reference_height_px は camelCase で読み取り、外科編集・新規挿入のラウンドトリップで剥がれ落ちない', () => {
  const source = JSON.stringify({
    default_text_style: { size_px: 36, reference_height_px: 720, zone: 'bottom' },
    captions: [
      caption('c-0001', 0, '基準高さ', { text_style: { reference_height_px: 1080, size_px: 54 } }),
      caption('c-0002', 2, '対象外')
    ]
  }, null, 2) + '\n';
  const parsed = parseCaptions(source);
  assert.equal(parsed.warnings.length, 0, '未知フィールド警告は出ない');
  assert.equal(parsed.defaultTextStyle.referenceHeightPx, 720);
  assert.equal(parsed.captions[0].textStyle.referenceHeightPx, 1080);
  assert.equal(parsed.captions[0].textStyle.sizePx, 54);

  const updated = updateCaptionTextStyleInSource(source, 'c-0001', { color: '#FFFFFF' });
  const reparsed = parseCaptions(updated);
  assert.equal(reparsed.captions[0].textStyle.color, '#FFFFFF', '変更したフィールドは反映される');
  assert.equal(reparsed.captions[0].textStyle.referenceHeightPx, 1080, 'cue 側の reference_height_px は剥がれ落ちない');
  assert.equal(reparsed.defaultTextStyle.referenceHeightPx, 720, 'default 側の reference_height_px は剥がれ落ちない');
  assert.match(updated, /"reference_height_px":\s*1080/);
  assert.match(updated, /"reference_height_px":\s*720/);

  // textStyleToJson 経路（新規挿入）でも snake_case で書き出される
  const inserted = insertCaptionLine('[]', {
    id: 'c-0001', start: 0, end: 1, text: '新規', speaker: null, sourceRef: null, edited: false,
    textStyle: { sizePx: 36, referenceHeightPx: 720 }
  });
  assert.match(inserted, /"reference_height_px":\s*720/);
  assert.equal(parseCaptions(inserted).captions[0].textStyle.referenceHeightPx, 720);
});

test('reference_height_px は integer >= 1 だけを取り込み、cue 側がフィールド単位で上書きし、layout との併用は layout を落とす', () => {
  for (const value of [0, -1, 0.5, '720', null]) {
    const parsed = parseCaptions(JSON.stringify([
      caption('c-0001', 0, '不正値', { text_style: { color: '#FFFFFF', reference_height_px: value } })
    ]));
    assert.equal(parsed.captions.length, 1, `${String(value)}: 行は捨てない`);
    assert.equal('referenceHeightPx' in parsed.captions[0].textStyle, false, `${String(value)}: 不正値は無視する`);
    assert.equal(parsed.captions[0].textStyle.color, '#FFFFFF');
  }
  assert.equal(mergeCaptionTextStyles({ sizePx: 36, referenceHeightPx: 720 }, { referenceHeightPx: 1080 }).referenceHeightPx, 1080);
  assert.equal(mergeCaptionTextStyles({ sizePx: 36, referenceHeightPx: 720 }, { color: '#FFFFFF' }).referenceHeightPx, 720);

  const layout = {
    mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
    left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1
  };
  const both = parseCaptions(JSON.stringify([
    caption('c-0001', 0, 'reference-and-layout', { text_style: { reference_height_px: 720, layout } })
  ]));
  assert.equal(both.captions[0].textStyle.referenceHeightPx, 720);
  assert.equal('layout' in both.captions[0].textStyle, false, 'schema の併用禁止: zone と同じ向きで layout を落とす');
});
