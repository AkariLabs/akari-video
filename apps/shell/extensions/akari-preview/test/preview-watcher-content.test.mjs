import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('字幕と edit の watcher は自己保存時刻で捨てず、内容を読む', async () => {
    const source = await readFile(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    const watcher = source.slice(source.indexOf('const handleFilesChanged = (event: FileChangesEvent)'),
        source.indexOf('const onEditStoreDidWrite = (event: Event)'));
    assert.match(watcher, /captionsChanged = true/);
    assert.match(watcher, /queueWatchedEdit\(\)/);
    assert.match(source, /while \(watchedEditPending && !widget\.isDisposed\)/);
    assert.match(source, /source !== lastQueuedEditContent/);
    assert.doesNotMatch(watcher, /captionsChanged \|\|= Date\.now\(\) - writtenAt/);
});
