// CLI レベルの決定論・--project 適用の smoke test。
// L0: 展開ツールのテスト緑 + node --check 対象は package.json 経由（node --test）。

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(here, '..', 'bin', 'expand-direction.mjs');

function run(args) {
  return execFileSync('node', [cliPath, ...args], { encoding: 'utf8' });
}

test('dry-run (no --project) prints a byte-identical patch across two invocations', () => {
  const args = ['neg-mono-popout', '--cut', '0', '--cut-in', '3.0', '--cut-out', '6.5', '--text', 'もう無理'];
  const first = run(args);
  const second = run(args);
  assert.equal(first, second);
  const patch = JSON.parse(first);
  assert.equal(patch.recipe_id, 'neg-mono-popout');
  assert.equal(patch.caption_patch.text, 'もう無理');
});

test('unknown recipe id exits non-zero with a clear message', () => {
  assert.throws(() => run(['no-such-recipe', '--cut', '0']));
});

test('requires-only recipe id exits non-zero (refuses expansion)', () => {
  assert.throws(() => run(['neg-color-invert', '--cut', '0']));
});

test('--project applies the patch onto edit.json/captions.json in place', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'direction-cli-test-'));
  try {
    await writeFile(
      path.join(dir, 'edit.json'),
      JSON.stringify({
        version: 0,
        output: { width: 1280, height: 720, fps: 30, look: null },
        source: { path: 'landscape.mp4' },
        cuts: [{ in: 3.0, out: 6.5 }],
        overlays: [],
      }),
      'utf8',
    );
    run(['neg-mono-popout', '--cut', '0', '--project', dir, '--text', 'もう無理', '--audio-root', path.join(dir, 'no-such-audio-root')]);
    const nextEdit = JSON.parse(await readFile(path.join(dir, 'edit.json'), 'utf8'));
    assert.deepEqual(nextEdit.output.look, { lut: 'mono', intensity: 1 });
    assert.equal(nextEdit.audio, undefined); // se_default couldn't resolve locally -> no audio.sfx written
    const captions = JSON.parse(await readFile(path.join(dir, 'captions.json'), 'utf8'));
    assert.equal(captions.captions[0].text, 'もう無理');
    const emphasis = nextEdit.emphasis_words[0];
    assert.equal(emphasis.style_hint, 'one-char-bang');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('applying the same recipe twice to two fresh projects yields byte-identical edit.json', async () => {
  const dirA = await mkdtemp(path.join(tmpdir(), 'direction-cli-test-a-'));
  const dirB = await mkdtemp(path.join(tmpdir(), 'direction-cli-test-b-'));
  try {
    const baseline = JSON.stringify({
      version: 0,
      output: { width: 1280, height: 720, fps: 30, look: null },
      source: { path: 'landscape.mp4' },
      cuts: [{ in: 3.0, out: 6.5 }],
      overlays: [],
    });
    await writeFile(path.join(dirA, 'edit.json'), baseline, 'utf8');
    await writeFile(path.join(dirB, 'edit.json'), baseline, 'utf8');
    for (const dir of [dirA, dirB]) {
      run(['neg-mono-shrink', '--cut', '0', '--project', dir, '--audio-root', path.join(dir, 'no-such-audio-root')]);
    }
    const editA = await readFile(path.join(dirA, 'edit.json'), 'utf8');
    const editB = await readFile(path.join(dirB, 'edit.json'), 'utf8');
    assert.equal(editA, editB);
  } finally {
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});
