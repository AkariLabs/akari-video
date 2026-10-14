import test, { after as afterI18nTest } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertCatalogCopy } from './i18n-source-copy.mjs';
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
afterI18nTest(() => setLanguage(undefined));


test('一覧の見出し、チャンネル動線、ホームの線と暗幕', () => {
    const list = readFileSync(new URL('../src/browser/home/project-list-view.tsx', import.meta.url), 'utf8');
    const panels = readFileSync(new URL('../src/browser/home/home-panels.tsx', import.meta.url), 'utf8');
    const home = readFileSync(new URL('../src/browser/home/project-home-style.ts', import.meta.url), 'utf8');
    assertCatalogCopy(list, 'チャンネル「');
    assert.match(list, /onOpenChannel/);
    assertCatalogCopy(list, 'チャンネルを開く');
    assert.match(panels, /backdrop-filter:blur\(6px\)/);
    assert.match(home, /--akari-line/);
});

test('札とサムネは行の版が変わったときだけ読み直す', () => {
    const list = readFileSync(new URL('../src/browser/home/project-list-view.tsx', import.meta.url), 'utf8');
    assert.match(list, /cached\.version !== props\.rowVersion/);
    assert.match(list, /if \(!props\.active\) return;/);
});
