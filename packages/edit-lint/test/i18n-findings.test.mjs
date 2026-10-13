import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setLanguage } from '../../i18n/index.mjs';
import { collectLicenseFindings } from '../src/license-findings.mjs';
import { validateCaptionTrackDeclaration, validateGeometryFitCompat } from '../src/lint/v2-projection.mjs';
import { validateProxyGops } from '../src/lint/media-checks.mjs';
import { renderLintReport } from '../src/report.mjs';
import { validateWorldSceneDeclaration } from '../src/world-scene-declaration.mjs';
import { lintText } from '../src/i18n.mjs';

test('English lint findings keep stable checks and translate messages', async (t) => {
  setLanguage('en');
  t.after(() => setLanguage(undefined));
  const geometry = [];
  validateGeometryFitCompat({ version: 2 }, {
    tracks: [{ lane: 'visual', items: [{ id: 'clip', source: { kind: 'media', sourceId: 'src' },
      legacy: { collection: 'cuts' }, declaration: {}, children: [] }] }],
  }, geometry);
  assert.equal(geometry[0].check, 'geometry.fit-compat');
  assert.match(geometry[0].message, /Rendering in fit compatibility mode/u);

  const captions = [];
  validateCaptionTrackDeclaration({ version: 2, tracks: [] }, [{ id: 'c-0001', start: 0, end: 1, text: 'Hello' }], captions);
  assert.equal(captions[0].check, 'v2.captions-track-undeclared');
  assert.match(captions[0].message, /no caption track is declared/u);

  const root = await mkdtemp(join(tmpdir(), 'lint-i18n-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const asset = join(root, 'assets', 'still', 'sample');
  await mkdir(asset, { recursive: true });
  await writeFile(join(asset, 'meta.json'), JSON.stringify({ title: 'Sample', license: { commercial: 'prohibited' } }));
  const license = await collectLicenseFindings({
    sources: [{ id: 'sample', path: 'assets/still/sample/frame.png' }],
    tracks: [{ items: [{ source: { src: 'sample' } }] }],
  }, (path) => join(root, path));
  assert.equal(license[0].check, 'license.non-commercial');
  assert.equal(license[0].message, 'Sample: this asset cannot be used commercially');
  const scene = validateWorldSceneDeclaration('<script type="application/json" data-akari-world-scene>{}</script>', null, 'overlays/world.html');
  assert.equal(scene[0].check, 'overlays.world-scene-declaration');
  assert.equal(scene[0].message, 'schemaVersion must be 1');
  const report = renderLintReport({ findings: [...geometry, ...captions, ...license], skipped: [],
    checked_at: '2026-10-11T00:00:00Z', verdict: 'pass' }, join(root, 'edit-lint-report.html'), root);
  assert.match(report, /<h2>Findings<\/h2>/u);
  assert.doesNotMatch(report, /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
});

test('proxy GOP finding follows the UI language while check stays stable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lint-proxy-i18n-'));
  t.after(() => { setLanguage(undefined); return rm(root, { recursive: true, force: true }); });
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'assets/proxy.mp4'), 'fixture');
  const probe = join(root, 'fake-ffprobe.mjs');
  await writeFile(probe, '#!/usr/bin/env node\nprocess.stdout.write("0.000000,K_\\n3.000000,K_\\n5.000000\\n");\n', { mode: 0o755 });
  const edit = { sources: [{ id: 'clip', proxy: 'assets/proxy.mp4' }] };
  const paths = { projectRoot: root, editPath: join(root, 'edit.json') };
  const options = { ffprobeCommand: probe, writeReports: false };
  setLanguage('en');
  const english = [];
  await validateProxyGops(edit, english, paths, options);
  assert.equal(english[0].check, 'source.proxy-long-gop');
  assert.match(english[0].message, /maximum keyframe interval is 3\.000 seconds/u);
  setLanguage('ja');
  const japanese = [];
  await validateProxyGops(edit, japanese, paths, options);
  assert.equal(japanese[0].check, 'source.proxy-long-gop');
  assert.match(japanese[0].message, /最大キーフレーム間隔が 3\.000 秒/u);
});

test('lint messages use singular English without changing Japanese text', () => {
  const params = { fonts: 'sample.ttf', count: 1, n: 1, sample: 'A' };
  setLanguage('en');
  try {
    assert.match(lintText('lint-messages.overlays.font.glyphsMissing', params), /1 character \(A\)/u);
    assert.match(lintText('lint-messages.media.proxyScale.legacyValue', {
      sourceId: 's1', scale: 2, count: 1, n: 1, originalWidth: 200, originalHeight: 100,
      proxyWidth: 100, proxyHeight: 50, ratio: 2,
    }), /1 cropped item matches/u);
    setLanguage('ja');
    assert.match(lintText('lint-messages.overlays.font.glyphsMissing', params), /無い字 1 件/u);
  } finally { setLanguage(undefined); }
});
