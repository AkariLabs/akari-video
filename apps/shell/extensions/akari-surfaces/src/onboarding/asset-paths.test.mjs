import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { welcomeImageCandidates } from '../../lib/onboarding/asset-paths.js';

test('開発配置では apps/shell の extensions からようこそ画像を探す', () => {
    const shell = join('C:', 'repo', 'apps', 'shell');
    const candidates = welcomeImageCandidates(join(shell, 'lib', 'backend'), shell);
    assert.ok(candidates.includes(join(shell, 'extensions', 'akari-surfaces', 'src', 'onboarding', 'welcome.webp')));
    assert.equal(candidates.length, new Set(candidates).size);
});

test('インストール配置では resources/app.asar の拡張パッケージを最初に探す', () => {
    const resources = join('C:', 'package', 'resources');
    const candidates = welcomeImageCandidates(join(resources, 'app.asar', 'lib', 'backend'), join('C:', 'elsewhere'), resources);
    assert.equal(candidates[0], join(resources, 'app.asar', 'node_modules', 'akari-surfaces', 'src', 'onboarding', 'welcome.webp'));
});
