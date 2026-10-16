import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { t } from '../../i18n/index.mjs';
import { renderPreviewIndex } from '../src/preview-index.mjs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/frame-engine-client.ts', import.meta.url), 'utf8');
const start = source.indexOf('function formatFrameEngineWarning(');
const end = source.indexOf('\ninterface TimelineUiSegment', start);
assert.ok(start > 0 && end > start);
const formatter = stripTypeScriptTypes(source.slice(start, end));
const oldMessage = 'clip: 最大キーフレーム間隔が 10.000 秒のため、シークとカット切り替えが遅くなります。GOP 1 秒以下の軽量版を用意してください（ffmpeg -i <input> … -g <fps> -keyint_min <fps> -sc_threshold 0 -bf 0 <output>）';

for (const language of ['ja', 'en']) {
  test(`preview index and frame-engine warning use ${language}`, () => {
    const previous = process.env.AKARI_LANG;
    try {
      process.env.AKARI_LANG = language;
      const rendered = renderPreviewIndex(html);
      assert.doesNotMatch(rendered, /AKARI_PREVIEW_MESSAGES -->/u);
      const window = {};
      const script = rendered.match(/<script>(window\.__AKARI_PREVIEW_MESSAGES__=[^<]+)<\/script>/u)?.[1];
      assert.ok(script);
      vm.runInNewContext(script, { window });
      assert.equal(window.__AKARI_PREVIEW_MESSAGES__.placeholderCard.defaultName,
        t('preview.previewWindow.placeholderCard.defaultName', {}, language));
      assert.equal(window.__AKARI_PREVIEW_MESSAGES__.placeholderCard.replaceHint,
        t('preview.previewWindow.placeholderCard.replaceHint', {}, language));
      const formatFrameEngineWarning = vm.runInNewContext(
        `(() => { ${formatter}; return formatFrameEngineWarning; })()`, { window });
      const actual = formatFrameEngineWarning(oldMessage,
        { code: 'long-gop', id: 'clip', gopSeconds: 10 });
      assert.equal(actual, t('render.frameEngine.warning.longGop',
        { id: 'clip', gopSeconds: '10.000' }, language));
      if (language === 'ja') assert.equal(actual, oldMessage);
      else assert.doesNotMatch(actual, /[\u3040-\u30ff\u3400-\u9fff]/u);
      assert.equal(formatFrameEngineWarning('other warning'), 'other warning');
      assert.match(source, /this\.showError\(formatFrameEngineWarning\(message, detail\), false\)/u);
    } finally {
      if (previous === undefined) delete process.env.AKARI_LANG;
      else process.env.AKARI_LANG = previous;
    }
  });
}
