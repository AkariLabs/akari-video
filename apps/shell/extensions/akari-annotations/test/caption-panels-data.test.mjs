import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import test from 'node:test';
import { CAPTION_PANEL_FONTS } from '../lib/common/caption-panel-catalog.js';
import { captionFontWeights } from '../lib/common/caption-panel-state.js';
import { CAPTION_PANEL_STYLES } from '../lib/browser/inspector/caption-panels.js';

const root = new URL('../../../../../', import.meta.url);
const FONT_TAGS = new Set(['japanese', 'handwriting', 'mincho', 'gothic', 'rounded',
    'display', 'emphasis', 'serif', 'pixel']);

test('フォント索引スナップショットは catalog/font の meta.json と一致する', () => {
    const catalog = new URL('catalog/font/', root);
    const actual = readdirSync(catalog).filter(id => existsSync(new URL(`${id}/meta.json`, catalog)))
        .map(id => {
            const meta = JSON.parse(readFileSync(new URL(`${id}/meta.json`, catalog), 'utf8'));
            return { id, title: meta.title, family: meta.title.replace(/（.*$/, '').trim(),
                tags: meta.tags.filter(tag => FONT_TAGS.has(tag)),
                bundled: existsSync(new URL(`assets/font/${id}/`, root)) };
        });
    assert.deepEqual(CAPTION_PANEL_FONTS.map(({ displayName, ...font }) => font), actual);
});

/** Read only the Japanese family/typographic-family names from an sfnt name table. */
function japaneseFamilyNames(file) {
    const bytes = readFileSync(file);
    const count = bytes.readUInt16BE(4);
    let table;
    for (let i = 0; i < count; i++) {
        const entry = 12 + i * 16;
        if (bytes.toString('ascii', entry, entry + 4) === 'name') table = bytes.readUInt32BE(entry + 8);
    }
    assert.ok(table !== undefined);
    const names = [];
    const storage = table + bytes.readUInt16BE(table + 4);
    for (let i = 0; i < bytes.readUInt16BE(table + 2); i++) {
        const entry = table + 6 + i * 12;
        const platform = bytes.readUInt16BE(entry);
        const language = bytes.readUInt16BE(entry + 4);
        const nameId = bytes.readUInt16BE(entry + 6);
        if (![1, 16].includes(nameId) || platform !== 3 || language !== 0x0411) continue;
        const start = storage + bytes.readUInt16BE(entry + 10);
        const name = new TextDecoder('utf-16be').decode(bytes.subarray(start,
            start + bytes.readUInt16BE(entry + 8)));
        if (name && !names.includes(name)) names.push(name);
    }
    return names;
}

test('同梱フォントの日本語表示名は日本語 name テーブルと一致し、未収録はあ字を添える', () => {
    const fonts = new URL('assets/font/', root);
    for (const font of CAPTION_PANEL_FONTS.filter(item => item.bundled)) {
        const directory = new URL(`${font.id}/`, fonts);
        const files = readdirSync(directory).filter(name => /\.(ttf|otf)$/iu.test(name));
        const japanese = [...new Set(files.flatMap(name => japaneseFamilyNames(new URL(name, directory))))];
        if (font.id === 'zen-maru-gothic') {
            assert.equal(font.displayName, 'Zen丸ゴシック');
        } else if (japanese.length) {
            assert.ok(japanese.includes(font.displayName), `${font.id}: ${japanese.join(', ')}`);
        } else {
            assert.equal(font.displayName, `${font.title} あ字`, font.id);
        }
    }
});

test('実行時テキストスタイル一覧は presets/textstyle/index.jsonl と一致する', () => {
    const index = readFileSync(new URL('presets/textstyle/index.jsonl', root), 'utf8').trim()
        .split(/\r?\n/u).map(line => JSON.parse(line)).map(({ id, name, style }) => ({ id, name, style }));
    const actual = CAPTION_PANEL_STYLES.map(({ id, name, style }) => ({ id, name, style }));
    assert.deepEqual(actual.sort((a, b) => a.id.localeCompare(b.id)),
        index.sort((a, b) => a.id.localeCompare(b.id)));
});

/** Minimal sfnt table reader: OS/2.usWeightClass and fvar.wght min/max. */
function fileWeights(file) {
    const bytes = readFileSync(file);
    const count = bytes.readUInt16BE(4);
    let staticWeight;
    let variable;
    for (let i = 0; i < count; i++) {
        const entry = 12 + i * 16;
        const tag = bytes.toString('ascii', entry, entry + 4);
        const offset = bytes.readUInt32BE(entry + 8);
        if (tag === 'OS/2') staticWeight = bytes.readUInt16BE(offset + 4);
        if (tag !== 'fvar') continue;
        const axisCount = bytes.readUInt16BE(offset + 8);
        const axisSize = bytes.readUInt16BE(offset + 10);
        const axisStart = offset + bytes.readUInt16BE(offset + 4);
        for (let j = 0; j < axisCount; j++) {
            const axis = axisStart + j * axisSize;
            if (bytes.toString('ascii', axis, axis + 4) !== 'wght') continue;
            const minimum = bytes.readInt32BE(axis + 4) / 65536;
            const maximum = bytes.readInt32BE(axis + 12) / 65536;
            variable = [];
            for (let weight = Math.ceil(minimum / 100) * 100; weight <= maximum; weight += 100) {
                variable.push(weight);
            }
        }
    }
    return variable ?? [staticWeight];
}

test('同梱フォントの太さ一覧は全ファイルの OS/2 と fvar.wght に一致する', () => {
    const fonts = new URL('assets/font/', root);
    const ids = readdirSync(fonts).filter(id => existsSync(new URL(`${id}/`, fonts)));
    for (const id of ids) {
        const directory = new URL(`${id}/`, fonts);
        const files = readdirSync(directory).filter(name => /\.(ttf|otf)$/iu.test(name));
        if (!files.length) continue;
        const weights = [...new Set(files.flatMap(name => fileWeights(new URL(name, directory))))].sort((a, b) => a - b);
        assert.deepEqual(captionFontWeights(id), weights, id);
    }
    assert.deepEqual(captionFontWeights('ab-kirigirisu'), []);
});
