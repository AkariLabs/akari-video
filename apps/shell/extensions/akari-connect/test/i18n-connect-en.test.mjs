import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setLanguage, t } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { connectSnapshot } = require('../lib/node/connect-state.js');

test('connection names and descriptions follow the selected language while status stays stable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-connect-i18n-'));
  const options = { home: root, roots: [], makerRoots: [root], env: { AKARI_HOME: root }, platform: 'darwin' };
  try {
    setLanguage('ja');
    const japanese = connectSnapshot(options).rows.find(row => row.id === '3d-recipes');
    assert.equal(japanese.name, '3D の設定');
    assert.equal(japanese.description, 'Blender で 3D 素材を作る');
    assert.equal(t('connect.connectProtocol.ui.availableLabel'), '使える');
    setLanguage('en');
    const english = connectSnapshot(options).rows.find(row => row.id === '3d-recipes');
    assert.equal(english.name, '3D settings');
    assert.equal(english.description, 'Create 3D assets with Blender');
    assert.equal(t('connect.connectProtocol.ui.availableLabel'), 'Available');
    assert.equal(english.status, japanese.status);
    assert.equal(english.try, japanese.try);
    assert.equal(english.tryLabel, 'Turn a logo into 3D');
  } finally { setLanguage(undefined); fs.rmSync(root, { recursive: true, force: true }); }
});
