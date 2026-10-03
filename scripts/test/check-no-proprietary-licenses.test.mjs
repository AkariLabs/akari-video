import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkBytes, checkDistribution } from '../release/check-no-proprietary-licenses.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const shell = JSON.parse(readFileSync(join(repo, 'apps/shell/package.json'), 'utf8'));
const meta = join(repo, 'apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/meta.json');

test('現状の同梱ファイルに旧ライセンス識別子はない', () => {
  assert.deepEqual(checkDistribution(shell), []);
});

test('お手本の meta.json が旧ライセンスに戻れば違反になる', () => {
  const violations = checkDistribution(shell, {
    readBytes: file => file === meta
      ? Buffer.from(readFileSync(file, 'utf8').replace('"spdx": "MIT"', '"spdx": "LicenseRef-AKARI-Assets-v0"'))
      : readFileSync(file),
  });
  assert.deepEqual(violations, ['apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/meta.json']);
});

test('コードの限定的な言及のみ許可し、素材には例外を設けない', () => {
  const data = Buffer.from('LicenseRef-AKARI-Assets-v0');
  assert.equal(checkBytes('packages/asset-resolver/src/license-axes.mjs', data), false);
  assert.equal(checkBytes('packages/audio-library-setup/shared/akari-sounds.mjs', data), false);
  assert.equal(checkBytes('assets/font/example.otf', data), true);
  assert.equal(checkBytes('presets/example.json', data), true);
  assert.equal(checkBytes('apps/shell/lib/akari-project.bundle.js', data), false);
  assert.equal(checkBytes('apps/shell/lib/akari-project.bundle.js', data, { allowGeneratedCode: false }), true);
  assert.equal(checkBytes('apps/shell/src-gen/akari-project.bundle.js', data), false);
  assert.equal(checkBytes('apps/shell/electron-entry.js', data), false);
  assert.equal(checkBytes('apps/shell/lib/license.json', data), true);
  assert.equal(checkBytes('apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/meta.json', data), true);
});
