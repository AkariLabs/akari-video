import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExportEncoderChoices, exportEncoderValues } from '../lib/common/export-encoder-choices.js';
import { buildQuickExportEncoderChoices } from '../lib/common/quick-export-cli.js';

test('共有エンコーダ選択肢は全 OS で既存の順序と表示名に一致する', () => {
    const automatic = { label: '自動（既定・ハードウェアが使えれば優先）', value: 'auto' };
    const software = { label: 'ソフトウェア（x264）', value: 'x264' };
    const expected = {
        darwin: [automatic, { label: 'ハードウェア（VideoToolbox）', value: 'videotoolbox' }, software],
        win32: [automatic,
            { label: 'ハードウェア（NVENC）', value: 'nvenc' },
            { label: 'ハードウェア（QSV）', value: 'qsv' },
            { label: 'ハードウェア（AMF）', value: 'amf' },
            { label: 'ハードウェア（Media Foundation）', value: 'mf' }, software],
        linux: [automatic, software]
    };
    for (const platform of ['darwin', 'win32', 'linux']) {
        assert.deepEqual(buildExportEncoderChoices(platform), expected[platform]);
        assert.deepEqual(buildExportEncoderChoices(platform), buildQuickExportEncoderChoices(platform));
    }
});

test('全エンコーダ値は OS 別の重複なし和集合になる', () => {
    const values = exportEncoderValues();
    assert.equal(values.length, new Set(values).size);
    assert.deepEqual([...values].sort(), ['auto', 'videotoolbox', 'nvenc', 'qsv', 'amf', 'mf', 'x264'].sort());
    assert.deepEqual(new Set(values), new Set(['darwin', 'win32', 'linux']
        .flatMap(platform => buildExportEncoderChoices(platform).map(({ value }) => value))));
});
