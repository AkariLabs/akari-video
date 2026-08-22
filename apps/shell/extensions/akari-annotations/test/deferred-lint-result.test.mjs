import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-widget.ts'), 'utf8');

test('a later successful lint clears only the stale lint failure banner', () => {
    const start = source.indexOf('protected showDeferredLintResult');
    const end = source.indexOf('protected async reloadAll', start);
    const method = source.slice(start, end);
    assert.match(method, /if \(pass\)[\s\S]*deferredLintFooterMessage\?\.parentElement === this\.footer[\s\S]*replaceChildren\(\)[\s\S]*deferredLintFooterMessage = undefined/);
    assert.match(method, /this\.deferredLintFooterMessage = message/);
});
