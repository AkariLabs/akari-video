import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
test('台本ヘッダの読み上げボタンは選択 ID と editUri を共通コマンドへ渡す', () => {
    assert.match(source, /readAloudButton\.className = 'akari-daihon-retime akari-daihon-read-aloud'/);
    assert.match(source, /readAloudButton\.textContent = '🔊 読み上げ'/);
    assert.match(source, /executeCommand\('akari\.caption\.readAloud',[\s\S]*?captionIds: \[\.\.\.this\.selection\.selected\][\s\S]*?this\.editUri\?\.toString\(\)/);
    assert.match(source, /this\.placeTextButton\.after\(this\.readAloudButton\)/);
});
