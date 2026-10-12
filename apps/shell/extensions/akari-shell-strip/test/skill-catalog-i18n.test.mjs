import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setLanguage } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { parseFrontmatter, skillDisplay } = require('../lib/common/skill-catalog.js');

test('skill cards use the catalog and preserve frontmatter metadata', () => {
    const entry = parseFrontmatter('---\nname: akari\ndescription: Source description\n---\n');
    assert.deepEqual(entry, { name: 'akari', description: 'Source description' });
    try {
        setLanguage('ja');
        assert.equal(skillDisplay(entry).description, 'AKARI Video のプロジェクトを作る・開く・続きから再開する');
        setLanguage('en');
        assert.equal(skillDisplay(entry).description, 'Create, open, or resume an AKARI Video project');
        assert.deepEqual(skillDisplay({ name: 'my-skill', description: 'Custom skill' }),
            { name: 'my-skill', description: 'Custom skill' });
    } finally { setLanguage(undefined); }
});
