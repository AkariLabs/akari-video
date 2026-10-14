import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyPresenceChange } from '../lib/browser/home/project-progress-change-model.js';

test('件数が変わらない通知と一時ファイルを無視する', () => {
    for (const relative of ['.akari/reports/edit-lint-report.html', '.akari/reports/create-project-report.html',
        'edit.json.123.tmp', 'planning-foo/plan.md', 'planning/plan.md.tmp', 'assets/notes.txt']) {
        assert.equal(classifyPresenceChange(relative, 1, false), undefined, relative);
    }
    assert.equal(classifyPresenceChange('planning/plan.md', 0, true), undefined);
    assert.equal(classifyPresenceChange('planning/plan.md', 1, true), undefined);
    assert.equal(classifyPresenceChange('planning/plan.md', 2, true), 'count');
    assert.equal(classifyPresenceChange('exports/final.mp4', 1, false), 'count');
    assert.equal(classifyPresenceChange('analysis-report.html', 1, false), 'count');
    assert.equal(classifyPresenceChange('planning', 2, false), 'count');
});

test('edit.json の通知は編集の有無だけを読む', () => {
    assert.equal(classifyPresenceChange('edit.json', 1, true), 'edit');
    const source = readFileSync(new URL('../src/browser/home/project-progress.ts', import.meta.url), 'utf8');
    assert.match(source, /count \? this\.refresh\(\) : edit \? this\.refreshEdit\(\)/);
    assert.match(source, /this\.readEditHasContent\(root\.resolve\('edit\.json'\)\)/);
    assert.match(source, /this\.refreshTimer = setTimeout\(/);
    assert.doesNotMatch(source, /event\.contains\(root\.resolve\(rel\)\)/);
});
