import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { skillCategory } = require('../lib/browser/skills/skills-panel-model.js');
const { SkillPictogram, skillPictogramFor, DEDICATED_PICTOGRAM_NAMES } =
    require('../lib/browser/skills/skill-pictograms.js');

const names = [
    'address-review', 'akari', 'analyze-footage', 'analyze-project', 'bake-3d',
    'beat-sync-edit', 'compile-review-session', 'create-project', 'critique-cut',
    'declare-audio', 'design-world', 'edit-lint', 'edit-plan', 'export-nle',
    'generate-media', 'generate-narration', 'harvest-asset', 'manage-connections',
    'overlay-authoring', 'render-cut', 'research-plan', 'setup-audio-library',
    'setup-chat-approval', 'setup-library', 'setup-remote', 'verify'
];

test('26 件すべてに専用の絵があり、パスが二枚の間で重複しない', () => {
    assert.equal(names.length, 26);
    assert.deepEqual([...DEDICATED_PICTOGRAM_NAMES].sort(), [...names].sort());
    const pathOwners = new Map();
    for (const name of names) {
        const category = skillCategory(name, '');
        assert.equal(skillPictogramFor(name, category).dedicated, true, name);
        const markup = renderToStaticMarkup(React.createElement(SkillPictogram, { name, category }));
        assert.match(markup, /<svg[^>]*viewBox="0 0 64 44"/);
        assert.match(markup, /width="64" height="44"/);
        assert.match(markup, /stroke-width="1.6"/);
        assert.match(markup, /aria-hidden="true"/);
        assert.doesNotMatch(markup.replaceAll('var(--akari-accent, #f97316)', ''),
            /#[0-9a-f]{3,8}\b/gi, `色の直書き: ${name}`);
        const paths = [...markup.matchAll(/\bd="([^"]+)"/g)].map(match => match[1]);
        assert.ok(paths.length >= 4 && paths.length <= 10, name);
        for (const d of paths) {
            assert.equal(pathOwners.get(d), undefined, `${name} と ${pathOwners.get(d)} のパスが重複`);
            pathOwners.set(d, name);
        }
    }
});

test('未知のスキルには種類別の絵を返す', () => {
    assert.equal(skillPictogramFor('made-up-skill', 'analysis').dedicated, false);
    const markup = renderToStaticMarkup(React.createElement(SkillPictogram, {
        name: 'made-up-skill', category: 'analysis'
    }));
    assert.match(markup, /^<svg/);
    assert.match(markup, /viewBox="0 0 64 44"/);
    assert.match(markup, /<path /);
});
