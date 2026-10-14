import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('台本の字幕と edit は時刻では捨てず内容差分を確認する', async () => {
    const source = await readFile(new URL('../src/browser/akari-transcript-widget.ts', import.meta.url), 'utf8');
    assert.match(source, /event\.contains\(this\.captionsUri\)\) \{\s*void this\.reloadWatchedCaptions\(\)/);
    assert.match(source, /source !== this\.lastAppliedCaptionsSource/);
    assert.match(source, /source !== this\.lastAppliedEditSource/);
    assert.match(source, /while \(this\.watchedCaptionsPending\)/);
    assert.match(source, /while \(this\.watchedEditPending\)/);
});
