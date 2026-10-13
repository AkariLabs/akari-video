import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ja = JSON.parse(readFileSync(new URL('../../../../../packages/i18n/locales/ja/surfaces.json', import.meta.url), 'utf8'));

export function assertCatalogCopy(source, expected) {
    const match = Object.entries(ja).find(([key, value]) =>
        value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').includes(expected) && source.includes(`t('${key}'`));
    assert.ok(match, expected);
}
