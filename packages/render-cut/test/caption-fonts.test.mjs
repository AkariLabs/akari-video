import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BUNDLED_CAPTION_FONT_FACES, BUNDLED_FONT_ROOT, captionFontFamilies, captionFontFaces, resolveBundledFontRoot } from '../src/caption-font-faces.mjs';
import { resolveCaptionPlan } from '../src/caption-resolve.mjs';
import { renderOverlaySheet } from '../src/rasterize.mjs';

const edit = { version: 1, output: { width: 1920, height: 1080, fps: 30 }, cuts: [{ src: 'base', in: 0, out: 2 }] };
const policy = { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
  unit_metric: 'ascii-half-other-one-v1', max_line_units: 24, minimum_fragment_duration_seconds: 0.72,
  locale: 'ja', lines: 1, wrap: 'multi' };
const cue = (font_family, id = 'c-font') => ({ id, src: 'base', start: 0, end: 1,
  text: '字幕', text_style: { font_family } });

test('one bundled registry supplies ten families and resolved CSS uses its faces', async t => {
  const home = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'caption-bundled-home-'));
  const previousHome = process.env.AKARI_HOME;
  const previousLibrary = process.env.AKARI_LIBRARY_ROOT;
  process.env.AKARI_HOME = home;
  delete process.env.AKARI_LIBRARY_ROOT;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.AKARI_HOME; else process.env.AKARI_HOME = previousHome;
    if (previousLibrary === undefined) delete process.env.AKARI_LIBRARY_ROOT; else process.env.AKARI_LIBRARY_ROOT = previousLibrary;
    await rm(home, { recursive: true, force: true });
  });
  assert.equal(BUNDLED_CAPTION_FONT_FACES.length, 14);
  assert.equal(new Set(BUNDLED_CAPTION_FONT_FACES.map(face => face.family)).size, 10);
  const alias = captionFontFaces().find(face => face.family === 'AKARI Noto Sans JP');
  assert.equal(alias?.path, captionFontFaces().find(face => face.family === 'Noto Sans JP')?.path);
  const latinAlias = captionFontFaces().find(face => face.family === 'AKARI Noto Sans');
  assert.equal(latinAlias?.path, captionFontFaces().find(face => face.family === 'Noto Sans')?.path);
  assert.equal(latinAlias?.weight, '100 900');
  const english = resolveCaptionPlan({ captionsRoot: {
    display_policy: { ...policy, locale: 'en' },
    captions: [{ id: 'c-en', src: 'base', start: 0, end: 1, text: 'The quick brown fox' }],
  }, edit });
  assert.deepEqual(english.warnings, []);
  assert.match(english.overlays[0].html, /font-family: "AKARI Noto Sans";[\s\S]*?\/caption-fonts\/noto-sans-alias\/NotoSans-Variable\.ttf/u);
  assert.match(english.overlays[0].html, /font-family: "AKARI Noto Sans JP";/u);
  const sheet = renderOverlaySheet({ overlays: english.overlays, edit, projectRoot: process.cwd(), duration: 2 });
  assert.match(sheet, /document\.fonts\.load\('600 82px "AKARI Noto Sans"', 'English captions'\)/u);
  const japaneseSheet = renderOverlaySheet({ overlays: [{ id: 'c-ja', start: 0, duration: 1,
    html: '<style>@font-face { font-family: "AKARI Noto Sans JP"; }</style><div>日本語</div>',
    vars: { '--caption-font-family': '"AKARI Noto Sans JP", sans-serif' } }],
    edit, projectRoot: process.cwd(), duration: 2 });
  assert.doesNotMatch(japaneseSheet, /document\.fonts\.load\('600 82px "AKARI Noto Sans"'/u);
  const root = { display_policy: policy, captions: [cue("'Noto Serif JP', serif")] };
  const plan = resolveCaptionPlan({ captionsRoot: root, edit });
  assert.deepEqual(plan.warnings, []);
  assert.match(plan.overlays[0].html, /font-family: "Noto Serif JP";[\s\S]*?\/caption-fonts\/noto-serif-jp\/NotoSerifJP-Variable\.ttf/u);
  const legacy = resolveCaptionPlan({ captionsRoot: { captions: [cue("'Noto Serif JP', serif")] }, edit });
  assert.match(legacy.overlays[0].html, /\/caption-fonts\/noto-serif-jp\/NotoSerifJP-Variable\.ttf/u);
  assert.doesNotMatch(legacy.overlays[0].html, /file:\/\//u);
  for (const family of ["'Noto Serif JP', serif", 'Noto Serif JP, serif', "'Noto Serif JP'"]) {
    const stacked = resolveCaptionPlan({ captionsRoot: { captions: [cue(family)] }, edit });
    assert.match(stacked.overlays[0].html, /\/caption-fonts\/noto-serif-jp\/NotoSerifJP-Variable\.ttf/u, family);
    assert.doesNotMatch(stacked.overlays[0].html, /file:\/\//u, family);
  }
  assert.deepEqual(captionFontFamilies("'Noto Serif JP', serif, \"M PLUS Rounded 1c\""),
    ['Noto Serif JP', 'M PLUS Rounded 1c']);
  const preset = resolveCaptionPlan({ captionsRoot: { display_policy: policy,
    captions: [{ ...cue(undefined, 'c-preset'), text_style: undefined, style_preset: 'narration-caption' }] }, edit });
  assert.deepEqual(preset.warnings, []);
  assert.match(preset.overlays[0].html, /\/caption-fonts\/noto-serif-jp\/NotoSerifJP-Variable\.ttf/u);
  for (const resolved of [false, true]) {
    const aliasPlan = resolveCaptionPlan({ captionsRoot: {
      ...(resolved ? { display_policy: policy } : {}), captions: [cue('AKARI Noto Sans JP', 'c-alias')],
    }, edit });
    assert.deepEqual(aliasPlan.warnings, []);
    assert.match(aliasPlan.overlays[0].html, /font-family: "AKARI Noto Sans JP";[\s\S]*?\/caption-fonts\/noto-sans-jp-alias\/NotoSansJP-Variable\.ttf/u);
  }
});

test('development Electron resourcesPath without fonts falls back to checked-in fonts', async t => {
  const resources = await mkdtemp(join(tmpdir(), 'caption-empty-electron-resources-'));
  t.after(() => rm(resources, { recursive: true, force: true }));
  assert.equal(resolveBundledFontRoot(resources), BUNDLED_FONT_ROOT);
  const packaged = join(resources, 'assets/font/noto-sans-jp');
  await mkdir(packaged, { recursive: true });
  await copyFile(join(BUNDLED_FONT_ROOT, 'noto-sans-jp/NotoSansJP-Variable.ttf'),
    join(packaged, 'NotoSansJP-Variable.ttf'));
  assert.equal(resolveBundledFontRoot(resources), join(resources, 'assets/font'));
});

test('library face resolves at export time and unavailable family warns with cue id', async t => {
  const home = await mkdtemp(join(tmpdir(), 'caption-font-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const dir = join(home, 'assets/font/probe-hand');
  await mkdir(dir, { recursive: true });
  await copyFile(join(BUNDLED_FONT_ROOT, 'dela-gothic-one/DelaGothicOne-Regular.ttf'), join(dir, 'ProbeHand-Regular.ttf'));
  await writeFile(join(dir, 'meta.json'), JSON.stringify({ id: 'probe-hand', category: 'font', title: 'Probe Hand（検証用）', tags: [], license: {} }));
  const previous = process.env.AKARI_HOME;
  process.env.AKARI_HOME = home;
  try {
    const faces = captionFontFaces();
    assert.equal(faces.find(face => face.family === 'Probe Hand')?.file, 'ProbeHand-Regular.ttf');
    const delivered = [];
    const plan = resolveCaptionPlan({ captionsRoot: { display_policy: policy,
      captions: [cue('Probe Hand', 'c-library'), { ...cue('Nonexistent Font', 'c-missing'), start: 1, end: 2 }] },
    edit, onWarning: warning => delivered.push(warning) });
    assert.match(plan.overlays[0].html, /\/caption-fonts\/library-probe-hand/u);
    assert.ok(plan.warnings.some(w => /c-missing.*Nonexistent Font/u.test(w)));
    assert.deepEqual(delivered, plan.warnings);
    assert.ok(!plan.warnings.some(w => /c-library/u.test(w)));
  } finally {
    if (previous === undefined) delete process.env.AKARI_HOME; else process.env.AKARI_HOME = previous;
  }
});
