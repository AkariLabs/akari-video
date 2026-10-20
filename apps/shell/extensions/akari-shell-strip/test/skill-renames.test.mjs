import { after as afterI18n } from 'node:test';
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
afterI18n(() => setLanguage(undefined));
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveSkillName, resolvedSkillDisplay, SKILL_RENAMES } = require('../lib/browser/skills/skill-renames.js');
const { skillCategory } = require('../lib/browser/skills/skills-panel-model.js');
const { skillPictogramFor } = require('../lib/browser/skills/skill-pictograms.js');

const table = [
    { from: 'old-a', to: 'old-b' },
    { from: 'old-b', to: 'bake-3d' }
];

test('改名表は連鎖を最後の新名に畳む（実リポの表は空）', () => {
    assert.deepEqual(SKILL_RENAMES, []);
    assert.equal(resolveSkillName('old-a', table), 'bake-3d');
    assert.equal(resolveSkillName('old-b', table), 'bake-3d');
    assert.equal(resolveSkillName('bake-3d', table), 'bake-3d');
    assert.equal(resolveSkillName('made-up', table), 'made-up');
});

test('旧名で引いても、一覧の説明・カテゴリ・絵は新名の項目になる', () => {
    const display = resolvedSkillDisplay({ name: 'old-a', description: 'source description' }, table);
    assert.equal(display.name, 'bake-3d');
    assert.equal(display.description, '3D シーンを Blender で映像素材に焼き、検証して配置');

    // カテゴリは新名から決まる（bake-3d は material ではなく other / 専用絵あり）。
    assert.equal(skillCategory('old-a', '', table), skillCategory('bake-3d', '', table));
    const pictogram = skillPictogramFor('old-a', 'other', table);
    assert.equal(pictogram.dedicated, true);
});

test('改名先が edit-lint ならカテゴリも新名から引く', () => {
    const rename = [{ from: 'review-old', to: 'edit-lint' }];
    assert.equal(skillCategory('review-old', '', rename), 'review');
    assert.equal(skillPictogramFor('review-old', 'other', rename).dedicated, true);
});
