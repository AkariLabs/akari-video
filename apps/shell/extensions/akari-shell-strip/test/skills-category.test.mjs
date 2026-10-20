import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage } from '@akari-video/i18n';

before(() => setLanguage('ja'));
after(() => setLanguage(undefined));
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { skillCategory, skillCategoryLabel, groupSkillsByCategory } =
    require('../lib/browser/skills/skills-panel-model.js');

const expected = {
    'edit-from-review': 'edit',
    akari: 'other',
    'analyze-footage': 'analysis',
    'analyze-project': 'analysis',
    'author-scene3d': 'other',
    'edit-to-beat': 'edit',
    'review-from-recording': 'review',
    'setup-project': 'setup',
    'review-cut': 'edit',
    'analyze-music': 'analysis',
    'author-world': 'other',
    'verify-edit': 'edit',
    'plan-edit': 'plan',
    'export-nle': 'export',
    'generate-image': 'material',
    'generate-narration': 'material',
    'generate-video': 'material',
    'harvest-asset': 'material',
    'setup-connections': 'setup',
    'author-overlay': 'other',
    'render-cut': 'edit',
    'plan-video': 'plan',
    'setup-chat-approval': 'setup',
    'setup-library': 'material',
    'setup-remote': 'setup',
    'verify-project': 'other'
};

test('26 件のスキル名を名前の語と優先順で分類する', () => {
    assert.equal(Object.keys(expected).length, 26);
    for (const [name, category] of Object.entries(expected)) {
        assert.equal(skillCategory(name, '説明に plan とあっても分類に使わない'), category, name);
    }
    assert.equal(skillCategory('planning', ''), 'other');
    assert.equal(skillCategory('review-plan', ''), 'plan');
    assert.equal(skillCategory('transcribe', ''), 'analysis');
    assert.equal(skillCategory('transcription', ''), 'analysis');
    assert.equal(skillCategory('inspect-media', ''), 'analysis');
});

test('小見出しは定めた順序で空の種を省く', () => {
    const groups = groupSkillsByCategory([
        { name: 'setup-remote', description: '' },
        { name: 'plan-edit', description: '' },
        { name: 'analyze-footage', description: '' },
        { name: 'generate-video', description: '' }
    ]);
    assert.deepEqual(groups.map(group => group.label), ['企画', '分析', '素材', 'セットアップ']);
    assert.equal(skillCategoryLabel('review'), '確認');
});
