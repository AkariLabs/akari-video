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
    { from: 'old-b', to: 'author-scene3d' }
];

test('改名表は連鎖を最後の新名に畳む（実リポの行も解決する）', () => {
    assert.ok(SKILL_RENAMES.length >= 1);
    for (const row of SKILL_RENAMES) {
        assert.equal(resolveSkillName(row.from), row.to);
        assert.equal(resolvedSkillDisplay({ name: row.from, description: 'source description' }).name, row.to);
    }
    assert.ok(SKILL_RENAMES.some(row => row.from === 'setup-audio-library' && row.to === 'setup-library'));
    assert.ok(SKILL_RENAMES.some(row => row.from === 'bake-3d' && row.to === 'author-scene3d'));
    assert.equal(resolveSkillName('old-a', table), 'author-scene3d');
    assert.equal(resolveSkillName('old-b', table), 'author-scene3d');
    assert.equal(resolveSkillName('author-scene3d', table), 'author-scene3d');
    assert.equal(resolveSkillName('made-up', table), 'made-up');
});

test('旧名で引いても、一覧の説明・カテゴリ・絵は新名の項目になる', () => {
    const display = resolvedSkillDisplay({ name: 'old-a', description: 'source description' }, table);
    assert.equal(display.name, 'author-scene3d');
    assert.equal(display.description, '3D の入口。既定は Three.js のライブ 3D、出せない絵だけ Blender で焼く');

    // カテゴリは新名から決まる（author-scene3d は material ではなく other / 専用絵あり）。
    assert.equal(skillCategory('old-a', '', table), skillCategory('author-scene3d', '', table));
    const pictogram = skillPictogramFor('old-a', 'other', table);
    assert.equal(pictogram.dedicated, true);
});

test('改名先が edit-lint ならカテゴリも新名から引く', () => {
    const rename = [{ from: 'review-old', to: 'edit-lint' }];
    assert.equal(skillCategory('review-old', '', rename), 'review');
    assert.equal(skillPictogramFor('review-old', 'other', rename).dedicated, true);
});
