import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BUNDLED_CAPTION_FONT_FACES, BUNDLED_FONT_ROOT, captionFontFamilies, captionFontFaces, libraryCaptionFontFaces, resolveBundledFontRoot } from '../src/caption-font-faces.mjs';
import { resolveCaptionPlan } from '../src/caption-resolve.mjs';
import { renderOverlaySheet } from '../src/rasterize.mjs';

const edit = { version: 1, output: { width: 1920, height: 1080, fps: 30 }, cuts: [{ src: 'base', in: 0, out: 2 }] };
const policy = { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
  unit_metric: 'ascii-half-other-one-v1', max_line_units: 24, minimum_fragment_duration_seconds: 0.72,
  locale: 'ja', lines: 1, wrap: 'multi' };
const cue = (font_family, id = 'c-font') => ({ id, src: 'base', start: 0, end: 1,
  text: '字幕', text_style: { font_family } });

function namedFont(family, japanese) {
  const records = [{ value: family, language: 0x0409 }, { value: japanese, language: 0x0411 }];
  const strings = records.map(({ value }) => {
    const bytes = Buffer.alloc(value.length * 2);
    for (let i = 0; i < value.length; i++) bytes.writeUInt16BE(value.charCodeAt(i), i * 2);
    return bytes;
  });
  const bytes = Buffer.alloc(28 + 6 + records.length * 12 + strings.reduce((sum, part) => sum + part.length, 0));
  bytes.writeUInt32BE(0x00010000, 0);
  bytes.writeUInt16BE(1, 4);
  bytes.write('name', 12, 'ascii');
  bytes.writeUInt32BE(28, 20);
  bytes.writeUInt32BE(bytes.length - 28, 24);
  bytes.writeUInt16BE(records.length, 30);
  bytes.writeUInt16BE(6 + records.length * 12, 32);
  let offset = 0;
  for (const [index, record] of records.entries()) {
    const at = 34 + index * 12;
    bytes.writeUInt16BE(3, at);
    bytes.writeUInt16BE(1, at + 2);
    bytes.writeUInt16BE(record.language, at + 4);
    bytes.writeUInt16BE(1, at + 6);
    bytes.writeUInt16BE(strings[index].length, at + 8);
    bytes.writeUInt16BE(offset, at + 10);
    strings[index].copy(bytes, 34 + records.length * 12 + offset);
    offset += strings[index].length;
  }
  return bytes;
}

async function fontFixture(t) {
  const home = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'caption-font-fixture-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const catalogRoot = join(home, 'catalog');
  await mkdir(join(catalogRoot, 'font'), { recursive: true });
  const env = { AKARI_HOME: home, AKARI_LIBRARY_ROOT: join(home, 'assets') };
  const add = async (id, meta, family, japanese) => {
    const dir = join(home, 'assets/font', id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.ttf`), namedFont(family, japanese));
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ id, category: 'font', tags: [], license: {}, ...meta }));
  };
  const catalog = async meta => {
    const dir = join(catalogRoot, 'font', meta.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta));
  };
  return { env, catalogRoot, add, catalog };
}

test('explicit metadata aliases produce only the title and its aliases', async t => {
  const f = await fontFixture(t);
  await f.add('one', { title: 'T', aliases: ['A1', 'A2'] }, 'English Family', '日本語書体');
  const faces = libraryCaptionFontFaces(f.env, { catalogRoot: f.catalogRoot });
  assert.deepEqual(faces.map(face => face.family), ['T', 'A1', 'A2']);
  assert.ok(faces.every(face => face.id === 'one' && face.path === faces[0].path && face.key === faces[0].key));
});

test('old metadata adds internal names and the catalog title without other file aliases', async t => {
  const f = await fontFixture(t);
  await f.add('a-first', { title: 'first-file' }, 'Sample Face A', '見本書体-かなA');
  await f.catalog({ id: 'sample-face', title: '見本書体', aliases: ['見本書体-かなA', '見本書体-かなB'] });
  const faces = libraryCaptionFontFaces(f.env, { catalogRoot: f.catalogRoot });
  assert.equal(faces[0].family, 'first-file');
  for (const family of ['見本書体-かなA', 'Sample Face A', '見本書体']) {
    const face = faces.find(row => row.family === family);
    assert.equal(face?.id, 'a-first', family);
    assert.equal(face?.path, faces[0].path, family);
    assert.equal(face?.key, faces[0].key, family);
  }
  assert.equal(faces.some(face => face.family === '見本書体-かなB'), false);
});

test('an old font owns its internal family ahead of another font catalog alias', async t => {
  const f = await fontFixture(t);
  await f.add('a-first', { title: 'first-file' }, 'Sample Face A', '見本書体-かなA');
  await f.add('b-second', { title: 'second-file' }, 'Sample Face B', '見本書体-かなB');
  await f.catalog({ id: 'sample-face', title: '見本書体', aliases: ['見本書体-かなA', '見本書体-かなB'] });
  const faces = libraryCaptionFontFaces(f.env, { catalogRoot: f.catalogRoot });
  assert.equal(faces.find(face => face.family === '見本書体-かなB')?.id, 'b-second');
  assert.equal(faces.find(face => face.family === '見本書体')?.id, 'a-first');
  assert.equal(faces.filter(face => face.family === '見本書体-かなB').length, 1);
  assert.equal(faces.filter(face => face.family === '見本書体').length, 1);
});

test('library faces include aliases and names from old metadata without later family overrides', async t => {
  const home = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'caption-names-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const source = join(BUNDLED_FONT_ROOT, 'dela-gothic-one/DelaGothicOne-Regular.ttf');
  for (const [id, meta] of [
    ['a-old', { title: 'ImportedFile', tags: [], license: {} }],
    ['b-other', { title: 'Other Font', aliases: ['Dela Gothic One'], tags: [], license: {} }],
  ]) {
    const dir = join(home, 'assets/font', id);
    await mkdir(dir, { recursive: true });
    await copyFile(source, join(dir, `${id}.ttf`));
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ id, category: 'font', ...meta }));
  }
  const faces = libraryCaptionFontFaces({ AKARI_HOME: home });
  assert.equal(faces[0].family, 'ImportedFile');
  assert.equal(faces.find(face => face.family === 'Dela Gothic One')?.id, 'a-old');
  assert.equal(faces.filter(face => face.family === 'Dela Gothic One').length, 1);
  assert.ok(faces.filter(face => face.id === 'a-old').every(face => face.path === faces[0].path && face.key === faces[0].key));
});

test('catalog aliases do not take a family explicitly owned by a later font', async t => {
  const home = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'caption-variants-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const source = join(BUNDLED_FONT_ROOT, 'dela-gothic-one/DelaGothicOne-Regular.ttf');
  for (const [id, title, aliases] of [
    ['a-first', 'First', ['Dela Gothic One', 'DelaGothicOne-Regular']],
    ['b-second', 'DelaGothicOne-Regular', []],
  ]) {
    const dir = join(home, 'assets/font', id);
    await mkdir(dir, { recursive: true });
    await copyFile(source, join(dir, `${id}.ttf`));
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ id, category: 'font', title, aliases, tags: [], license: {} }));
  }
  const faces = libraryCaptionFontFaces({ AKARI_HOME: home });
  assert.equal(faces.find(face => face.family === 'Dela Gothic One')?.id, 'a-first');
  assert.equal(faces.find(face => face.family === 'DelaGothicOne-Regular')?.id, 'b-second');
});

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
