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
    assert.deepEqual(CAPTION_PANEL_FONTS, actual);
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
