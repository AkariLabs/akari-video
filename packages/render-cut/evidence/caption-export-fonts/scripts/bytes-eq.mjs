// bytes-eq.mjs <repo-root> <out.json> : font_family を持たない captions.json の字幕 HTML・OSR ページ・GPU の組み立て結果を出力する（repo root は <ROOT> に正規化）
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, out] = process.argv.slice(2);
const { resolveCaptionPlan } = await import(pathToFileURL(join(root, 'packages/render-cut/src/caption-resolve.mjs')).href);
const { buildOsrPage } = await import(pathToFileURL(join(root, 'packages/osr-export/src/page-builder.mjs')).href);
const norm = s => String(s).split(root.replace(/^\/tmp\//, '/private/tmp/')).join('<ROOT>').split(root).join('<ROOT>');
const sha = s => createHash('sha256').update(norm(s)).digest('hex');
const POLICY = { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1', unit_metric: 'ascii-half-other-one-v1', max_line_units: 19, minimum_fragment_duration_seconds: 0.72, locale: 'ja', lines: 1, wrap: 'multi' };
const edit = { version: 1, output: { width: 1280, height: 720, fps: 30 }, sources: [{ id: 'a', path: 'assets/base.mp4' }], cuts: [{ id: 'cut-1', src: 'a', in: 0, out: 10, at: 0, track: 0 }], overlays: [] };
const cues = (extra = {}) => [0, 1, 2].map(i => ({ id: `c-000${i + 1}`, start: i + 0.1, end: i + 0.9, text: '今日のまとめ Abc 123', ...extra }));
const cases = {
  'legacy-plain': cues(),
  'legacy-default-style-no-family': { default_text_style: { zone: 'bottom', size_px: 64 }, captions: cues() },
  'legacy-text-style-no-family': { captions: cues({ text_style: { color: '#FFD400', font_weight: 900, stroke: { color: '#D12B2B', width_px: 5 } } }) },
  'resolved-plain': { display_policy: POLICY, captions: cues({ time_domain: 'output' }) },
  'resolved-text-style-no-family': { display_policy: POLICY, captions: cues({ time_domain: 'output', text_style: { color: '#FFD400', font_weight: 900 } }) },
};
const result = {};
for (const [name, captionsRoot] of Object.entries(cases)) {
  const plan = resolveCaptionPlan({ captionsRoot, edit });
  const page = buildOsrPage({ edit: { ...edit, captions: undefined }, captions: captionsRoot, projectRoot: '/tmp/none', duration: 3 });
  result[name] = { overlays: sha(JSON.stringify(plan.overlays)), warnings: plan.warnings, osrPageHtml: sha(page.html), osrSheet: sha(page.overlaySheetHtml) };
}
writeFileSync(out, JSON.stringify(result, null, 2));
