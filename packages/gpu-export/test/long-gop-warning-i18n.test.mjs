import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { t } from '../../i18n/index.mjs';

const runtime = readFileSync(new URL('../src/page-runtime.js', import.meta.url), 'utf8');
const start = runtime.indexOf('  function warn(message, detail) {');
const end = runtime.indexOf('\n  function describeRunError', start);
assert.ok(start > 0 && end > start);
const warnSource = runtime.slice(start, end);
const oldMessage = 'clip: 最大キーフレーム間隔が 10.000 秒のため、シークとカット切り替えが遅くなります。GOP 1 秒以下の軽量版を用意してください（ffmpeg -i <input> … -g <fps> -keyint_min <fps> -sc_threshold 0 -bf 0 <output>）';

for (const language of ['ja', 'en']) {
  test(`GPU page converts structured long-GOP warning to ${language}`, () => {
    const warnings = [];
    const context = {
      warnings,
      pageConfig: { messages: { longGop: t('render.frameEngine.warning.longGop', {}, language) } },
      console: { warn() {} },
    };
    const warn = vm.runInNewContext(`(() => { ${warnSource}; return warn; })()`, context);
    warn(oldMessage, { code: 'long-gop', id: 'clip', gopSeconds: 10 });
    assert.equal(warnings[0], t('render.frameEngine.warning.longGop', { id: 'clip', gopSeconds: '10.000' }, language));
    if (language === 'ja') assert.equal(warnings[0], oldMessage);
    else assert.doesNotMatch(warnings[0], /[\u3040-\u30ff\u3400-\u9fff]/u);
    warn('other warning');
    assert.equal(warnings[1], 'other warning');
  });
}
