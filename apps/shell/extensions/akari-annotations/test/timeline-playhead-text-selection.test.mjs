import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const shellChrome = readFileSync(new URL('../../akari-theme/src/browser/akari-shell-inner-chrome.ts', import.meta.url), 'utf8');

test('playhead handle suppresses native selection; shell CSS covers the line grab', () => {
    const handle = source.split('protected onPlayheadHandlePointerDown(event: PointerEvent): void {')[1]?.split('\n    }')[0] ?? '';
    assert.match(handle, /event\.preventDefault\(\)/);
    assert.match(source, /this\.strip\.addEventListener\('pointerdown', event => this\.onSelectPlayheadLinePointerDown\(event\), true\)/);
    assert.match(shellChrome, /body\s*\{[^}]*user-select:\s*none/s);
});
