// L0: presets/direction/index.jsonl の全レシピについて、参照 id が実在プリセット / SE カタログに
// 解決することを機械検査する（契約書 §5-1）。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRecipeIndex, findDuplicateIds } from '../src/recipes.mjs';
import { MEANING_VOCABULARY, MEANING_RULES } from '../../audio-library-setup/shared/sfx-suggest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

async function readJsonl(relPath) {
  const text = await readFile(path.join(repoRoot, relPath), 'utf8');
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

// captions.mjs は SUPPORTED_EMPHASIS_STYLES をエクスポートしていない（読み取り専用のため変更しない）。
// 本テストは契約書 §2-2 に転記した一覧を正としつつ、実ソースにその一覧が「存在すること」を
// 正規表現で検査することで drift を検出する。
const EXPECTED_EMPHASIS_STYLES = [
  'one-char-bang', 'one-char-jumble', 'size-pulse', 'color-accent', 'color-only',
  'outline-bold', 'danger', 'positive', 'highlight',
];

let recipes;
let lutIds;
let fxIds;
let textanimById;
let telopBeats;
let telopTones;
let captionsSource;

test.before(async () => {
  recipes = parseRecipeIndex(await readFile(path.join(repoRoot, 'presets/direction/index.jsonl'), 'utf8'));
  lutIds = new Set((await readJsonl('presets/luts/index.jsonl')).map((r) => r.id));
  fxIds = new Set((await readJsonl('presets/fx/index.jsonl')).map((r) => r.id));
  const textanim = await readJsonl('presets/textanim/index.jsonl');
  textanimById = new Map(textanim.map((r) => [r.id, r.slot]));
  const telop = await readJsonl('presets/telop/index.jsonl');
  telopBeats = new Set(telop.flatMap((r) => r.use_when?.beats ?? []));
  telopTones = new Set(telop.flatMap((r) => r.use_when?.tone ?? []));
  captionsSource = await readFile(
    path.join(repoRoot, 'packages/render-cut/src/captions.mjs'),
    'utf8',
  );
});

test('index.jsonl has no duplicate ids', () => {
  assert.deepEqual(findDuplicateIds(recipes), []);
});

test('has at least 30 recipes and 33 expandable (non-requires) recipes', () => {
  assert.ok(recipes.length >= 30, `expected >=30 recipes, got ${recipes.length}`);
  const expandable = recipes.filter((r) => !r.requires || r.requires.length === 0);
  assert.equal(expandable.length, 33);
});

test('requires-only recipes are exactly {neg-color-invert} (契約書 §4)', () => {
  const requiresOnly = recipes.filter((r) => r.requires && r.requires.length > 0).map((r) => r.id).sort();
  assert.deepEqual(requiresOnly, ['neg-color-invert']);
});

test('person_matte recipe vocabulary has explicit quality and decode width', () => {
  const recipe = recipes.find((item) => item.id === 'neg-person-cutout');
  assert.deepEqual(recipe.layers.person_matte, { quality: 'accurate', decode_width: 1280 });
});

test('EXPECTED_EMPHASIS_STYLES matches captions.mjs SUPPORTED_EMPHASIS_STYLES source (drift guard)', () => {
  const match = captionsSource.match(/SUPPORTED_EMPHASIS_STYLES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(match, 'could not locate SUPPORTED_EMPHASIS_STYLES in captions.mjs — has the export shape changed?');
  const found = [...match[1].matchAll(/EMPHASIS_STYLE_[A-Z_]+/g)].map((m) => m[0]);
  // captions.mjs holds these as named consts (EMPHASIS_STYLE_ONE_CHAR_BANG = "one-char-bang", ...);
  // resolve each const name to its string value from the same source file.
  const values = found.map((constName) => {
    const constMatch = captionsSource.match(new RegExp(`const ${constName} = "([^"]+)"`));
    assert.ok(constMatch, `could not resolve value of ${constName}`);
    return constMatch[1];
  });
  assert.deepEqual([...values].sort(), [...EXPECTED_EMPHASIS_STYLES].sort());
});

test('every recipe.layers.look.lut resolves to a presets/luts id', () => {
  for (const r of recipes) {
    if (r.layers?.look) {
      assert.ok(lutIds.has(r.layers.look.lut), `${r.id}: unknown lut "${r.layers.look.lut}"`);
    }
  }
});

test('every recipe.layers.fx[].id resolves to a presets/fx id', () => {
  for (const r of recipes) {
    for (const fx of r.layers?.fx ?? []) {
      assert.ok(fxIds.has(fx.id), `${r.id}: unknown fx id "${fx.id}"`);
    }
  }
});

test('color-overlay fx entries always carry params.color (fx-v0 contract requirement)', () => {
  for (const r of recipes) {
    for (const fx of r.layers?.fx ?? []) {
      if (fx.id === 'color-overlay') {
        assert.ok(fx.params?.color, `${r.id}: color-overlay fx missing params.color`);
      }
    }
  }
});

test('every recipe.layers.text.anim_in/anim_out resolves to a textanim id with slot=in', () => {
  for (const r of recipes) {
    for (const key of ['anim_in', 'anim_out']) {
      const id = r.layers?.text?.[key];
      if (id) {
        assert.equal(textanimById.get(id), 'in', `${r.id}: textanim "${id}" (${key}) is not slot=in`);
      }
    }
  }
});

test('every recipe.layers.text.anim_loop resolves to a textanim id with slot=loop', () => {
  for (const r of recipes) {
    const id = r.layers?.text?.anim_loop;
    if (id) {
      assert.equal(textanimById.get(id), 'loop', `${r.id}: textanim "${id}" is not slot=loop`);
    }
  }
});

test('every recipe.layers.text.style_hint is a known emphasis style', () => {
  for (const r of recipes) {
    const hint = r.layers?.text?.style_hint;
    if (hint) {
      assert.ok(EXPECTED_EMPHASIS_STYLES.includes(hint), `${r.id}: unknown style_hint "${hint}"`);
    }
  }
});

test('every recipe.layers.audio.se_meaning is in MEANING_VOCABULARY (or null)', () => {
  for (const r of recipes) {
    const meaning = r.layers?.audio?.se_meaning;
    if (meaning !== null && meaning !== undefined) {
      assert.ok(MEANING_VOCABULARY.includes(meaning), `${r.id}: unknown se_meaning "${meaning}"`);
    }
  }
});

test('every recipe.layers.audio.se_default is one of MEANING_RULES[se_meaning].first (or null)', () => {
  for (const r of recipes) {
    const { se_meaning: meaning, se_default: defaultId } = r.layers?.audio ?? {};
    if (defaultId !== null && defaultId !== undefined) {
      assert.ok(meaning, `${r.id}: se_default set without se_meaning`);
      const candidates = MEANING_RULES[meaning]?.first ?? [];
      assert.ok(candidates.includes(defaultId), `${r.id}: se_default "${defaultId}" is not in MEANING_RULES["${meaning}"].first`);
    }
  }
});

test('every recipe.use_when.beats is a subset of the telop beats vocabulary', () => {
  for (const r of recipes) {
    for (const beat of r.use_when?.beats ?? []) {
      assert.ok(telopBeats.has(beat), `${r.id}: unknown beat "${beat}"`);
    }
  }
});

test('every recipe.use_when.tone is a subset of the telop tone vocabulary', () => {
  for (const r of recipes) {
    for (const tone of r.use_when?.tone ?? []) {
      assert.ok(telopTones.has(tone), `${r.id}: unknown tone "${tone}"`);
    }
  }
});

test('every recipe.use_when.strength_min is a number within [0, 1]', () => {
  for (const r of recipes) {
    const s = r.use_when?.strength_min;
    assert.equal(typeof s, 'number', `${r.id}: strength_min missing/non-number`);
    assert.ok(s >= 0 && s <= 1, `${r.id}: strength_min out of range: ${s}`);
  }
});

test('requires-only recipes have no fx/framing/freeze/transition_in (nothing to silently drop)', () => {
  for (const r of recipes) {
    if (r.requires && r.requires.length > 0) {
      assert.ok(!r.layers?.fx?.length, `${r.id}: requires-only recipe should not declare fx`);
      assert.ok(!r.layers?.framing, `${r.id}: requires-only recipe should not declare framing`);
      assert.ok(!r.layers?.freeze, `${r.id}: requires-only recipe should not declare freeze`);
      assert.ok(!r.layers?.transition_in, `${r.id}: requires-only recipe should not declare transition_in`);
    }
  }
});

test('category is one of the 5 known categories', () => {
  const known = new Set(['negative', 'positive', 'anger-hype', 'surprise-emergency', 'normal']);
  for (const r of recipes) {
    assert.ok(known.has(r.category), `${r.id}: unknown category "${r.category}"`);
  }
});
