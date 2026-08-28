import test from 'node:test';
import assert from 'node:assert/strict';
import { composeExportRequestPacket } from '../lib/common/export-request-packet.js';

// 固定テンプレートに一字一句一致することを確認する（設定値 + 明示承認済み文言）。

test('composeExportRequestPacket: lint 再実行する — テンプレート全文一致', () => {
    const packet = composeExportRequestPacket({
        resolutionLabel: '1080p 横',
        outputName: 'final.mp4',
        rerunLint: true,
        engine: 'auto'
    });
    assert.equal(
        packet,
        '【書き出し依頼】edit.json を render-cut スキルで書き出してください。'
        + '設定: 解像度 1080p 横・出力名 final.mp4・lint 再実行 する・書き出しエンジン auto。'
        + 'ユーザーは書き出しダイアログで設定を確定済み（明示承認済み・チャット再確認不要）。'
        + '進捗を .akari/render.json に随時書き込みながら進めてください'
    );
});

test('composeExportRequestPacket: lint 再実行しない・別解像度/出力名', () => {
    const packet = composeExportRequestPacket({
        resolutionLabel: '正方形',
        outputName: 'v2-square.mp4',
        rerunLint: false,
        engine: 'legacy'
    });
    assert.equal(
        packet,
        '【書き出し依頼】edit.json を render-cut スキルで書き出してください。'
        + '設定: 解像度 正方形・出力名 v2-square.mp4・lint 再実行 しない・書き出しエンジン legacy。'
        + 'ユーザーは書き出しダイアログで設定を確定済み（明示承認済み・チャット再確認不要）。'
        + '進捗を .akari/render.json に随時書き込みながら進めてください'
    );
    assert.equal(/[\r\n]/.test(packet), false, 'パケットは 1 行でなければならない');
});
