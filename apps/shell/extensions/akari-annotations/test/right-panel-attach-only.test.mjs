import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('素材イベントはインスペクターを配置するだけで current を変えない', () => {
    const source = read('../src/browser/akari-inspector-widget.ts');
    const listener = source.slice(source.indexOf('window.addEventListener(AKARI_MATERIAL_SELECTED_EVENT'));
    assert.match(listener, /'akari\.inspector\.open', \{ tabId: 'generation', attachOnly: true \}/);
    assert.match(listener, /shell\.addWidget\(widget, \{ area: 'right' \}\)/);
    assert.doesNotMatch(listener, /shell\.(?:activateWidget|revealWidget)\(/);
});

test('review.json の追加は注釈タブを配置するだけで current を変えない', () => {
    const source = read('../src/browser/akari-annotations-contribution.ts');
    assert.match(source, /scheduleReviewOpen\(\(\) => void this\.openReviewPanel\(true\)\)/);
    assert.match(source, /const timeline = attachOnly \? await this\.attach\(\) : await this\.openCurrentTimeline\(\)/);
    assert.match(source, /if \(!attachOnly\) await this\.shell\.activateWidget\(widget\.id\)/);
});
