import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { readHandlerSource } from './helpers/handler-source.mjs';

const compiledUrl = new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url);
const source = readHandlerSource();
const compiled = readFileSync(compiledUrl, 'utf8');
const require = createRequire(compiledUrl);

function method(name) {
    const start = compiled.search(new RegExp(`^    (?:async )?${name}\\(`, 'mu'));
    assert.ok(start >= 0, name);
    const end = compiled.indexOf('\n    }', start);
    assert.ok(end > start, name);
    return compiled.slice(start, end + '\n    }'.length);
}

const Host = new Function('edit_store_1', 'caption_run_style_notice_1',
    `return class { ${method('listRunMyStyles')} ${method('runStyleChoices')} };`)(
    require('@akari-video/edit-store'), require('../common/caption-run-style-notice.js'));

test('マイスタイルのコマンドが無い・例外・配列以外は同梱候補だけに戻る', async () => {
    const host = new Host();
    const calls = [];
    for (const executeCommand of [
        async () => { throw new Error('command not registered'); },
        async () => { throw new Error('command failed'); },
        async () => ({ id: 'invalid' })
    ]) {
        host.commandService = { executeCommand: async (...args) => {
            calls.push(args);
            return executeCommand();
        } };
        const saved = await host.listRunMyStyles();
        assert.deepEqual(saved, []);
        assert.ok(host.runStyleChoices(saved, 38).every(choice => choice.id.startsWith('preset:')));
    }
    assert.deepEqual(calls, Array(3).fill(['akari.library.listMyStyles']));
});

test('コマンドで得た見た目が範囲スタイル候補に並ぶ', async () => {
    const host = new Host();
    host.commandService = { executeCommand: async () => [{
        id: 'favorite', name: 'お気に入り', parts: [
            { kind: 'motion' }, { kind: 'look', text_style: { color: '#ff0000' } }
        ]
    }] };
    const choices = host.runStyleChoices(await host.listRunMyStyles(), 38);
    const mine = choices.filter(choice => choice.id === 'mine:favorite');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].name, 'お気に入り');
    assert.equal(mine[0].style.color, '#ff0000');
    assert.ok(choices.some(choice => choice.id.startsWith('preset:')));
    assert.match(source, /const saved = await this\.listRunMyStyles\(\);\s*const choices = this\.runStyleChoices\(saved, baseSize\);/u);
});

test('文字範囲では同梱スタイルの文字倍率を保ち、リッチ語彙の省略を通知する', () => {
    const host = new Host();
    const choices = host.runStyleChoices([{ id: 'saved', name: '保存',
        parts: [{ kind: 'look', text_style: { size_px: 90, color: '#fff' } }] }], 56);
    const impact = choices.find(choice => choice.id === 'preset:title-impact');
    assert.equal(impact.style.scale, 1);
    assert.ok(Math.abs(impact.style.stroke.width_px - 10 * 56 / 168) < 1e-10);
    assert.equal(choices.find(choice => choice.id === 'mine:saved').style.scale, 90 / 56);
    const omitted = require('@akari-video/edit-store').captionRunStyleFromLook({ size_px: 168,
        fill: { type: 'solid', color: '#fff' }, strokes: [{ color: '#000', width_px: 10 }] }, 168);
    assert.match(require('../common/caption-run-style-notice.js').captionRunOmittedNotice(omitted.omitted),
        /文字範囲に使えない見た目/u);
    assert.deepEqual(omitted.omitted, ['fill', 'strokes']);
});
