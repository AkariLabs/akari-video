import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../src/browser/${name}`, import.meta.url), 'utf8');

test('つなぐコマンドは設定のつなぐへ進み、詳細 id を渡す', () => {
    const contribution = source('connect-contribution.tsx');
    assert.match(contribution, /id: 'akari\.connect\.open'/);
    assert.match(contribution, /executeCommand\('akari\.settings\.open', \{ section: 'connections', connectorId: arg\?\.id \}\)/);
    assert.doesNotMatch(contribution, /getOrCreateWidget|addWidget|activateWidget/);
    const module = source('connect-frontend-module.ts');
    assert.match(module, /SettingsSectionBodyContributionSymbol/);
    assert.doesNotMatch(module, /WidgetFactory/);
});

test('設定内のカードは React 19 の root で描き、見出しの下へ置く', () => {
    const section = source('connect-settings-section.tsx');
    assert.match(section, /createRoot, Root.*react-dom\/client/);
    assert.match(section, /const root = createRoot\(mount\)/);
    assert.match(section, /root\.unmount\(\)/);
    assert.match(section, /this\.root\?\.render\(this\.renderContent\(\)\)/);
    assert.match(section, /host\.insertBefore\(mount, defaults\)/);
    assert.match(section, /lead\.after\(mount\)/);
    assert.doesNotMatch(section, /ReactDOM\.render|unmountComponentAtNode|<h2>つなぐ<\/h2>/);
});
