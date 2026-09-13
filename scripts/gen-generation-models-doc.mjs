#!/usr/bin/env node
// packages/schemas/gen-models.json から日英の生成モデル一覧を再生成する。
// マーカーコメント間だけを書き換え、--check では差分の有無だけを検査する。
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BEGIN = '<!-- BEGIN GENERATED generation-models — scripts/gen-generation-models-doc.mjs が生成。手で編集しない -->';
export const END = '<!-- END GENERATED generation-models -->';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const markerPattern = new RegExp(`${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}`);
const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const list = (values, empty) => values === null ? empty : values.join(', ');
const number = (value) => String(value);

const words = {
  ja: {
    videoHeading: '動画モデル', imageHeading: '画像モデル',
    videoHeaders: ['id', 'family', 'provider', '最初のフレーム', '最後のフレーム', '参照画像 max', '参照動画 max', '参照音声 max', '尺', '解像度', '音声出力', 'seed', '価格', 'as_of', 'verified', '較正'],
    imageHeaders: ['id', 'family', 'provider', '参照画像 max', '解像度', '価格', 'as_of', 'verified'],
    format: '書式', default: '既定', noDefault: '既定なし', integer: '整数', string: '文字列', stringSuffix: '文字列（8s 形式）', stringAuto: '文字列（auto 可）',
    resolutions: '解像度', aspects: '縦横比', notSpecified: '指定なし',
    audioTrue: '切替可', audioAlways: '常に付く', audioFalse: 'なし', yes: 'あり', no: 'なし',
    units: { usd_per_second: '$/秒', usd_per_image: '$/画像', usd_per_clip: '$/クリップ' },
    audioMultiplier: '音声', calibrationCount: (count) => `${count} 件`, calibrationSeparator: '、'
  },
  en: {
    videoHeading: 'Video models', imageHeading: 'Image models',
    videoHeaders: ['id', 'family', 'provider', 'First frame', 'Last frame', 'Reference images max', 'Reference videos max', 'Reference audio max', 'Duration', 'Resolution', 'Audio output', 'seed', 'Price', 'as_of', 'verified', 'Calibration'],
    imageHeaders: ['id', 'family', 'provider', 'Reference images max', 'Resolution', 'Price', 'as_of', 'verified'],
    format: 'format', default: 'default', noDefault: 'no default', integer: 'integer', string: 'string', stringSuffix: 'string (8s format)', stringAuto: 'string (auto allowed)',
    resolutions: 'resolutions', aspects: 'aspects', notSpecified: 'not specified',
    audioTrue: 'switchable', audioAlways: 'always included', audioFalse: 'none', yes: 'yes', no: 'no',
    units: { usd_per_second: '$/second', usd_per_image: '$/image', usd_per_clip: '$/clip' },
    audioMultiplier: 'audio', calibrationCount: (count) => `${count} ${count === 1 ? 'entry' : 'entries'}`, calibrationSeparator: ', '
  }
};

const frame = (value) => ({ required: '○', optional: '△', none: '−' })[value];
const referenceMax = (reference) => reference.max === null ? '?' : number(reference.max);

const durationFormat = (format, w) => {
  if (format.type === 'integer') return w.integer;
  if (format.suffix === 's') return w.stringSuffix;
  if (format.auto === true) return w.stringAuto;
  return w.string;
};

const duration = (value, w) => {
  const range = value.kind === 'enum'
    ? value.values.map(number).join('/')
    : `${number(value.min)}〜${number(value.max)}（step ${number(value.step)}）`;
  const defaultValue = value.default === null ? w.noDefault : `${w.default}: ${number(value.default)}`;
  return `${range}; ${w.format}: ${durationFormat(value.format, w)}; ${defaultValue}`;
};

const resolution = (model, w) => {
  const resolutions = list(model.resolutions, w.notSpecified);
  const aspects = list(model.aspects, w.notSpecified);
  return `${w.resolutions}: ${resolutions}; ${w.aspects}: ${aspects}`;
};

const price = (value, w) => {
  if (value === null) return '—';
  const unit = w.units[value.unit];
  const amounts = Object.entries(value.by_resolution).map(([resolutionName, amount]) =>
    resolutionName === '' ? `${number(amount)} ${unit}` : `${resolutionName}: ${number(amount)} ${unit}`
  );
  if (value.audio_multiplier !== null) amounts.push(`${w.audioMultiplier} ×${number(value.audio_multiplier)}`);
  return amounts.join('; ');
};

const calibration = (values, w) => values.length === 0
  ? w.calibrationCount(0)
  : `${w.calibrationCount(values.length)}: ${values.join(w.calibrationSeparator)}`;

const markdownTable = (headers, rows) => [
  `| ${headers.map(cell).join(' | ')} |`,
  `|${headers.map(() => '---').join('|')}|`,
  ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)
].join('\n');

export const buildGeneratedBlock = (models, locale) => {
  const w = words[locale];
  if (!w) throw new Error(`unsupported locale: ${locale}`);
  const videos = models.filter((model) => model.kind === 'video').map((model) => [
    model.id,
    model.family,
    model.provider,
    frame(model.inputs.first_frame),
    frame(model.inputs.last_frame),
    referenceMax(model.inputs.reference_images),
    referenceMax(model.inputs.reference_videos),
    referenceMax(model.inputs.reference_audios),
    duration(model.duration, w),
    resolution(model, w),
    model.audio_out === 'always' ? w.audioAlways : model.audio_out ? w.audioTrue : w.audioFalse,
    model.seed ? w.yes : w.no,
    price(model.price, w),
    model.as_of,
    model.verified,
    calibration(model.calibration, w)
  ]);
  const images = models.filter((model) => model.kind === 'image').map((model) => [
    model.id,
    model.family,
    model.provider,
    referenceMax(model.inputs.reference_images),
    resolution(model, w),
    price(model.price, w),
    model.as_of,
    model.verified
  ]);
  return [
    BEGIN,
    '',
    `## ${w.videoHeading}`,
    '',
    markdownTable(w.videoHeaders, videos),
    '',
    `## ${w.imageHeading}`,
    '',
    markdownTable(w.imageHeaders, images),
    '',
    END
  ].join('\n');
};

export const renderDocument = (current, models, locale) => {
  if (!markerPattern.test(current)) throw new Error('マーカーが見つからない');
  return `${current.replace(markerPattern, buildGeneratedBlock(models, locale)).replace(/\n*$/, '')}\n`;
};

const fail = (msg) => { console.error(`gen-generation-models-doc: ${msg}`); process.exit(1); };

const main = () => {
  try {
    const catalog = JSON.parse(readFileSync(join(root, 'packages/schemas/gen-models.json'), 'utf8'));
    const targets = [
      { path: join(root, 'docs/guides/generation-models.ja.md'), locale: 'ja' },
      { path: join(root, 'docs/guides/generation-models.md'), locale: 'en' }
    ];
    const results = targets.map((target) => {
      const current = readFileSync(target.path, 'utf8');
      return { ...target, current, next: renderDocument(current, catalog.models, target.locale) };
    });
    if (process.argv.includes('--check')) {
      if (results.some(({ current, next }) => current !== next)) {
        fail('生成モデル一覧がドリフトしています。`npm run gen:generation-models` で再生成してコミットしてください');
      }
      console.log(`gen-generation-models-doc: drift なし（${catalog.models.length} 件）`);
      return;
    }
    for (const { path, next } of results) writeFileSync(path, next);
    console.log(`gen-generation-models-doc: ${catalog.models.length} 件で再生成`);
  } catch (error) {
    fail(error.message);
  }
};

if (realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) main();
