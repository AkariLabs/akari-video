import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { t } from '../../i18n/index.mjs';
import { buildOsrPage } from '../src/page-builder.mjs';

const runtime = readFileSync(new URL('../src/page-runtime.js', import.meta.url), 'utf8');
const start = runtime.indexOf('  function warn(message, detail) {');
const end = runtime.indexOf('\n  function mediaUrl', start);
assert.ok(start > 0 && end > start);
const warnSource = runtime.slice(start, end);
const oldMessage = 'clip: 最大キーフレーム間隔が 10.000 秒のため、シークとカット切り替えが遅くなります。GOP 1 秒以下の軽量版を用意してください（ffmpeg -i <input> … -g <fps> -keyint_min <fps> -sc_threshold 0 -bf 0 <output>）';
const edit = { version: 2, output: { width: 64, height: 36, fps: 30 }, sources: [], cuts: [], overlays: [] };

for (const language of ['ja', 'en']) {
  test(`OSR page converts structured long-GOP warning to ${language}`, () => {
    const previous = process.env.AKARI_LANG;
    try {
      process.env.AKARI_LANG = language;
      const page = buildOsrPage({ edit, projectRoot: '/unused', duration: 1,
        frameEngineBundle: '', pageRuntime: '' });
      const config = JSON.parse(page.html.match(/window\.__AKARI_OSR_CONFIG__=([^;]+);/u)?.[1] ?? 'null');
      assert.equal(config.messages.longGop, t('render.frameEngine.warning.longGop', {}, language));
      const warnings = [];
      const warn = vm.runInNewContext(`(() => { ${warnSource}; return warn; })()`, {
        warnings, config, console: { warn() {} },
      });
      warn(oldMessage, { code: 'long-gop', id: 'clip', gopSeconds: 10 });
      assert.equal(warnings[0], t('render.frameEngine.warning.longGop',
        { id: 'clip', gopSeconds: '10.000' }, language));
      if (language === 'ja') assert.equal(warnings[0], oldMessage);
      else assert.doesNotMatch(warnings[0], /[\u3040-\u30ff\u3400-\u9fff]/u);
      warn('other warning');
      assert.equal(warnings[1], 'other warning');
    } finally {
      if (previous === undefined) delete process.env.AKARI_LANG;
      else process.env.AKARI_LANG = previous;
    }
  });
}
