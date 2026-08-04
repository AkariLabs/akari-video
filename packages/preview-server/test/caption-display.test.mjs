import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { replaceCaptionStyleVariables } from '../public/caption-style.js';
import { resolveCaptionApiPayload } from '../src/caption-api.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(packageRoot, '../..');
const styleParity = JSON.parse(await readFile(join(
  repositoryRoot, 'packages/edit-store/test/fixtures/caption-style-validation-parity.json'
), 'utf8'));

const caption = {
  id: 'c-0001', start: 0, end: 2, text: '今回設定します', speaker: null,
  sourceRef: { segment: 0 }, edited: false,
};

const policyRoot = {
  display_policy: {
    mode: 'single_line_sequential',
    algorithm: 'a4-ja-two-fragment-v1',
    unit_metric: 'ascii-half-other-one-v1',
    max_line_units: 6,
    minimum_fragment_duration_seconds: 0.72,
    locale: 'ja',
    break_hints: { preferred_second_starts: ['設定'] },
  },
  captions: [{ ...caption, display_fragments: ['今回', '設定します'] }],
};

const edit = {
  version: 0,
  source: { path: 'source.mp4' },
  cuts: [{ in: 0, out: 2 }],
  output: { width: 1920, height: 1080, fps: 30 },
};

test('legacy captions payload does not require edit.json and is byte-shape compatible', () => {
  const legacy = [caption];
  assert.equal(resolveCaptionApiPayload(legacy, null), legacy);
  const objectLegacy = { captions: [caption] };
  assert.equal(resolveCaptionApiPayload(objectLegacy, null), objectLegacy);
});

test('policy payload is resolved in Node and returns timeline-domain display cues', () => {
  const payload = resolveCaptionApiPayload(policyRoot, edit);
  assert.equal(payload.schema, 'caption-layout/v1');
  assert.deepEqual(payload.captions.map(cue => cue.text), ['今回', '設定します']);
  assert.ok(payload.captions.every(cue => cue.source_cue_id === 'c-0001'));
  assert.throws(() => resolveCaptionApiPayload(policyRoot, null), /edit\.json is required/u);
});

test('policy API fails closed for malformed cues and version 1 source-reference mismatches', () => {
  const multiEdit = {
    version: 1,
    sources: [{ id: 'a' }, { id: 'b' }],
    cuts: [{ src: 'a', in: 0, out: 2 }],
    output: { width: 1920, height: 1080, fps: 30 },
  };
  const withCaptions = captions => ({ ...policyRoot, captions });
  assert.throws(() => resolveCaptionApiPayload(withCaptions([{ ...caption, src: 'ghost' }]), multiEdit), /does not reference edit\.json sources/u);
  assert.throws(() => resolveCaptionApiPayload(withCaptions([{ ...caption, start: 1, end: 1, src: 'a' }]), multiEdit), /0 <= start < end/u);
  assert.throws(() => resolveCaptionApiPayload(withCaptions([
    { ...caption, src: 'a' }, { ...caption, start: 2, end: 3, src: 'a' },
  ]), multiEdit), /captions\[\]\.id is duplicated/u);
  assert.throws(() => resolveCaptionApiPayload(withCaptions([{ ...caption, src: 'a' }]), {
    ...multiEdit, cuts: [{ src: 'ghost', in: 0, out: 2 }],
  }), /cuts\[0\]\.src does not reference/u);
});

test('preview API direct calls reject malformed opt-in styles and unknown nested keys', () => {
  const malformed = {
    display_policy: styleParity.display_policy,
    default_text_style: { color: 17, size_px: '82', font_weight: '600', line_height: 0 },
    captions: [styleParity.caption],
  };
  assert.throws(() => resolveCaptionApiPayload(malformed, styleParity.edit), /default_text_style/u);
  const nestedUnknown = {
    display_policy: styleParity.display_policy,
    captions: [{ ...styleParity.caption, text_style: {
      stroke: { method: 'webkit-outline', color: '#050505', width_px: 5, invented: true },
    } }],
  };
  assert.throws(() => resolveCaptionApiPayload(nestedUnknown, styleParity.edit), /invented/u);
});

test('managed CSS variables are replaced between resolved cues without style leakage', () => {
  const values = new Map();
  const style = {
    setProperty: (name, value) => values.set(name, value),
    removeProperty: name => values.delete(name),
  };
  replaceCaptionStyleVariables(style, {
    '--caption-color': '#ffffff',
    '--caption-webkit-text-stroke': '5px #050505',
    '--caption-left': '261px',
    '--caption-width': '1120px',
    '--caption-bottom': '29px',
  });
  replaceCaptionStyleVariables(style, { '--caption-color': '#00ff00' });
  assert.deepEqual(Object.fromEntries(values), { '--caption-color': '#00ff00' });
});

test('browser edit-kernel bundle contains selection but no caption resolver or Segmenter', async () => {
  const bundle = await readFile(join(packageRoot, 'public', 'edit-kernel.bundle.js'), 'utf8');
  assert.match(bundle, /findActiveResolvedCaption/u);
  assert.doesNotMatch(bundle, /resolveCaptionDisplay/u);
  assert.doesNotMatch(bundle, /Intl\.Segmenter/u);
  assert.doesNotMatch(bundle, /a4-ja-two-fragment-v1/u);
});
