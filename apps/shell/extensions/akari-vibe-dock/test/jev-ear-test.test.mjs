import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { AkariEarServiceImpl } from '../lib/node/ear-service.js';

const earModulePath = resolve(import.meta.dirname, '../../../../../packages/akari-ear/src/index.mjs');

test('検証用の文字入口は環境変数があるときだけ確定文を届ける', async () => {
    const values = [];
    const client = { onStatus() {}, onLevel() {}, onUtterance: value => values.push(value) };
    const disabled = new AkariEarServiceImpl({ earModulePath, env: {} });
    disabled.setClient(client);
    assert.equal((await disabled.getCapabilities()).testText, undefined);
    await disabled.injectTestUtterance('動画だけ');
    assert.equal(values.length, 0);
    const enabled = new AkariEarServiceImpl({ earModulePath, env: { AKARI_JEV_TEST_TEXT: '1' } });
    enabled.setClient(client);
    assert.equal((await enabled.getCapabilities()).testText, true);
    await enabled.injectTestUtterance('動画だけ');
    assert.equal(values.length, 1);
    assert.equal(values[0].final, true);
    assert.equal(values[0].text, '動画だけ');
    assert.equal(values[0].kind, 'speech');
    await enabled.notifyRoughCanvas({ type: 'roughCanvas.opened', canvasId: 'paper', at: 1 });
    await enabled.injectTestUtterance('ペン');
    assert.equal(values[1].kind, 'command');
});
