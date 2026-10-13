import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('一覧の見出し、チャンネル動線、ホームの線と暗幕', () => {
    const list = readFileSync(new URL('../src/browser/home/project-list-view.tsx', import.meta.url), 'utf8');
    const panels = readFileSync(new URL('../src/browser/home/home-panels.tsx', import.meta.url), 'utf8');
    const home = readFileSync(new URL('../src/browser/home/project-home-style.ts', import.meta.url), 'utf8');
    assert.match(list, /チャンネル「\{props\.channel\}」のプロジェクト/);
    assert.match(list, /onOpenChannel/);
    assert.match(list, /チャンネルを開く/);
    assert.match(panels, /backdrop-filter:blur\(6px\)/);
    assert.match(home, /--akari-line/);
});

test('変わった行だけ札とサムネを読み直す', () => {
    const list = readFileSync(new URL('../src/browser/home/project-list-view.tsx', import.meta.url), 'utf8');
    const home = readFileSync(new URL('../src/browser/akari-home-widget.tsx', import.meta.url), 'utf8');
    assert.match(list, /\}, \[row\.key, props\.rowVersion, props\.active\]\);/);
    assert.match(list, /rowVersion=\{props\.rowVersion\?\.\(row\.uri\)\}/);
    assert.doesNotMatch(list, /refreshToken/);
    assert.doesNotMatch(home, /projectListRefreshToken/);
    assert.match(home, /if \(force\) await this\.channelContext\.refresh\(\)/);
    assert.match(home, /this\.projectRowVersions\.set\(key, \(this\.projectRowVersions\.get\(key\) \?\? 0\) \+ 1\)/);
});
