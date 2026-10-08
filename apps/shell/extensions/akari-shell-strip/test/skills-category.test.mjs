import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { skillCategory, skillCategoryLabel, groupSkillsByCategory } =
    require('../lib/browser/skills/skills-panel-model.js');

const expected = {
    'address-review': 'review',
    akari: 'other',
    'analyze-footage': 'other',
    'analyze-project': 'other',
    'bake-3d': 'other',
    'beat-sync-edit': 'edit',
    'compile-review-session': 'review',
    'create-project': 'other',
    'critique-cut': 'edit',
    'declare-audio': 'material',
    'design-world': 'other',
    'edit-lint': 'edit',
    'edit-plan': 'plan',
    'export-nle': 'export',
    'generate-media': 'material',
    'generate-narration': 'material',
    'harvest-asset': 'material',
    'manage-connections': 'setup',
    'overlay-authoring': 'other',
    'render-cut': 'edit',
    'research-plan': 'plan',
    'setup-audio-library': 'material',
    'setup-chat-approval': 'setup',
    'setup-library': 'material',
    'setup-remote': 'setup',
    verify: 'other'
};

test('26 件のスキル名を名前の語と優先順で分類する', () => {
    assert.equal(Object.keys(expected).length, 26);
    for (const [name, category] of Object.entries(expected)) {
        assert.equal(skillCategory(name, '説明に plan とあっても分類に使わない'), category, name);
    }
    assert.equal(skillCategory('planning', ''), 'other');
    assert.equal(skillCategory('review-plan', ''), 'plan');
});

test('小見出しは定めた順序で空の種を省く', () => {
    const groups = groupSkillsByCategory([
        { name: 'setup-remote', description: '' },
        { name: 'edit-plan', description: '' },
        { name: 'generate-media', description: '' }
    ]);
    assert.deepEqual(groups.map(group => group.label), ['企画', '素材', 'セットアップ']);
    assert.equal(skillCategoryLabel('review'), '確認');
});
