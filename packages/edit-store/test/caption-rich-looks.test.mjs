import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { parseCaptions, updateCaptionTextStyleInSource } from '../lib/caption-store.js';
import { resolveCaptionStyleForOutput, validateCaptionTextStyle } from '../lib/caption-display.js';

const parity = JSON.parse(readFileSync(new URL('./fixtures/caption-style-validation-parity.json', import.meta.url)));
const cases = {
  valid: parity.valid_style_cases.filter(item => item.id.startsWith('rich-')),
  invalid: parity.invalid_cases.filter(item => item.id.startsWith('rich-')).map(item =>
    ({ id: item.id, style: item.caption_text_style }))
};
const cue = style => ({ id: 'c-0001', start: 0, end: 2, text: '見本', speaker: null,
  sourceRef: null, edited: true, text_style: style });

function runValidator(style) {
  const dir = mkdtempSync(join(tmpdir(), 'akari-rich-validation-'));
  try {
    const file = join(dir, 'captions.json');
    writeFileSync(file, JSON.stringify({ captions: [cue(style)] }));
    return spawnSync(process.execPath, [new URL('../../schemas/bin/validate-captions.mjs', import.meta.url).pathname, file],
      { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('rich look parity fixture agrees across schema CLI, display kernel, and edit-store', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schemas/captions.schema.json', import.meta.url)));
  const validateSchema = new Ajv2020({ strict: false }).compile(schema);
  for (const key of ['stroke_inner', 'fill_gradient', 'extrude']) assert.ok(schema.$defs.textStyle.properties[key]);
  for (const item of cases.valid) {
    assert.equal(validateSchema({ captions: [cue(item.style)] }), true,
      `${item.id}: ${JSON.stringify(validateSchema.errors)}`);
    const result = runValidator(item.style);
    assert.equal(result.status, 0, `${item.id}: ${result.stderr}`);
    assert.doesNotThrow(() => validateCaptionTextStyle(item.style), item.id);
    const parsed = parseCaptions(JSON.stringify({ captions: [cue(item.style)] }));
    assert.deepEqual(parsed.warnings, [], item.id);
    assert.ok(parsed.captions[0].textStyle, item.id);
  }
  for (const item of cases.invalid) {
    assert.equal(validateSchema({ captions: [cue(item.style)] }), false, item.id);
    assert.equal(runValidator(item.style).status, 1, item.id);
    assert.throws(() => validateCaptionTextStyle(item.style), undefined, item.id);
  }
});

test('rich look fields survive write, read, replacement, and removal', () => {
  const source = JSON.stringify({ captions: [cue({ color: '#ffffff' })] });
  const patch = { stroke: { color: '#000000', widthPx: 9 },
    strokeInner: { color: '#ffffff', widthPx: 3 },
    fillGradient: { colors: ['#fb923c', '#8b5cf6'], angleDeg: 90 },
    extrude: { depthPx: 8, color: '#a16207', colorEnd: '#5c2a09', angleDeg: 135 } };
  const written = updateCaptionTextStyleInSource(source, 'c-0001', patch);
  const raw = JSON.parse(written).captions[0].text_style;
  assert.equal(runValidator(raw).status, 0);
  assert.deepEqual(raw.stroke_inner, { color: '#ffffff', width_px: 3 });
  assert.deepEqual(raw.fill_gradient, { colors: ['#fb923c', '#8b5cf6'], angle_deg: 90 });
  assert.deepEqual(raw.extrude, { depth_px: 8, color: '#a16207', color_end: '#5c2a09', angle_deg: 135 });
  const parsed = parseCaptions(written).captions[0].textStyle;
  assert.deepEqual(parsed.strokeInner, patch.strokeInner);
  assert.deepEqual(parsed.fillGradient, patch.fillGradient);
  assert.deepEqual(parsed.extrude, patch.extrude);
  const removed = updateCaptionTextStyleInSource(written, 'c-0001',
    { strokeInner: null, fillGradient: null, extrude: null });
  assert.deepEqual(JSON.parse(removed).captions[0].text_style,
    { color: '#ffffff', stroke: { color: '#000000', width_px: 9 } });
});

test('shared CSS variables scale px values and compose existing shadow', () => {
  const style = { ...cases.valid.find(item => item.id === 'rich-combined').style, reference_height_px: 720 };
  const vars = resolveCaptionStyleForOutput(style, { width: 1920, height: 1080 }).vars;
  assert.equal(vars['--caption-webkit-text-stroke'], '27px #000000');
  assert.equal(vars['--caption-fill-gradient'], 'linear-gradient(90deg, #fb923c, #8b5cf6)');
  assert.equal(vars['--caption-fill-color'], 'transparent');
  assert.match(vars['--caption-text-shadow'], /4\.5px 0px 0 #ffffff/u);
  assert.match(vars['--caption-text-shadow'], /#a16207/u);
  assert.match(vars['--caption-text-shadow'], /rgba\(0,0,0,1\)/u);
  assert.match(vars['--caption-fill-filter'], /^drop-shadow\(/u);
  assert.match(vars['--caption-fill-filter'], /#ffffff/u);
  assert.match(vars['--caption-fill-filter'], /#000000/u);
  assert.match(vars['--caption-fill-filter'], /#a16207/u);
  assert.match(vars['--caption-fill-filter'], /rgba\(0,0,0,1\)/u);
  assert.equal(resolveCaptionStyleForOutput(cases.valid.find(item => item.id === 'rich-gradient').style,
    { width: 1280, height: 720 }).vars['--caption-fill-filter'], 'none');
});

test('gradient filter grows outlines in logarithmic steps and keeps outer stroke for plain double outlines', () => {
  const gradient = cases.valid.find(item => item.id === 'rich-gradient').style.fill_gradient;
  const outline = { stroke: { color: '#000000', width_px: 9 },
    stroke_inner: { color: '#ffffff', width_px: 3 } };
  const plain = resolveCaptionStyleForOutput(outline, { width: 1280, height: 720 }).vars;
  assert.equal(plain['--caption-webkit-text-stroke'], '18px #000000');
  assert.equal(plain['--caption-stroke'], '18px #000000');
  assert.equal((plain['--caption-text-shadow'].match(/#ffffff/gu) ?? []).length, 16);
  const single = resolveCaptionStyleForOutput({ fill_gradient: gradient,
    stroke: { color: '#123456', width_px: 3 } }, { width: 1280, height: 720 }).vars;
  assert.equal((single['--caption-fill-filter'].match(/drop-shadow\(/gu) ?? []).length, 8);
  const double = resolveCaptionStyleForOutput({ fill_gradient: gradient, ...outline,
    extrude: { depth_px: 4, color: '#a16207', angle_deg: 135 } }, { width: 1280, height: 720 }).vars;
  assert.equal((double['--caption-fill-filter'].match(/drop-shadow\(/gu) ?? []).length, 24);
  assert.ok(double['--caption-fill-filter'].indexOf('#ffffff')
    < double['--caption-fill-filter'].indexOf('#000000'));
});

test('render-cut, shell, Web UI, and GPU input share gradient CSS contract', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const render = read('../../render-cut/src/captions.mjs');
  const shell = read('../../../apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts');
  const web = read('../../preview-server/public/app.js');
  const gpu = read('../../gpu-export/src/page-runtime.js');
  for (const css of [render, shell, web]) {
    assert.match(css, /background-image:\s*var\(--caption-fill-gradient,\s*none\)/u);
    assert.match(css, /-webkit-background-clip:\s*var\(--caption-fill-clip,\s*border-box\)/u);
    assert.match(css, /-webkit-text-fill-color:\s*var\(--caption-fill-color,\s*currentColor\)/u);
    assert.match(css, /-webkit-text-stroke:\s*0 transparent/u);
    assert.match(css, /text-shadow:\s*none/u);
    assert.match(css, /filter:\s*var\(--caption-fill-filter,\s*none\)/u);
    assert.match(css, /\.akari-caption__tok[\s\S]*--caption-fill-gradient/u);
  }
  assert.match(gpu, /root\.innerHTML = .*\$\{html\}/u);
});
