import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const catalogUrl = new URL('../src/common/partner-catalog.json', import.meta.url);

test('Command Code CLI がパートナーカタログに一意な CLI として載る', async () => {
    const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'));
    const matches = catalog.filter(entry => entry.agent === 'commandcode');

    assert.deepEqual(matches, [{
        id: 'langbase/command-code-cli',
        agent: 'commandcode',
        form: 'cli',
        name: 'Command Code CLI',
        description: 'Command Code を PTY タブで直接使います',
        recommended: false
    }]);
    assert.equal(catalog.filter(entry => entry.form === 'cli').length, 8);
});
